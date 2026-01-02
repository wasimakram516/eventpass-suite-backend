const Registration = require("../../models/Registration");
const { sendCustomWhatsApp } = require("../../services/whatsappService");

const {
    resolveRecipientContext,
    formatPhoneForWhatsApp,
} = require("../../utils/whatsappProcessorUtils");

const {
    emitEmailProgress,
} = require("../../socket/modules/eventreg/eventRegSocket");

/* ---------- helpers ---------- */
const stripHtml = (html) => {
    if (!html) return "";
    return html
        .replace(/<[^>]*>/g, "")
        .replace(/&nbsp;/g, " ")
        .replace(/&amp;/g, "&")
        .replace(/&lt;/g, "<")
        .replace(/&gt;/g, ">")
        .replace(/&quot;/g, '"')
        .replace(/&#39;/g, "'")
        .trim();
};

const formatCustomMessage = (subject, body) => {
    const cleanSubject = stripHtml(subject || "");
    const cleanBody = stripHtml(body || "");

    let msg = "";
    if (cleanSubject) msg = `*${cleanSubject}*\n\n`;
    if (cleanBody) msg += cleanBody;

    return msg.trim();
};

/* ---------- processor ---------- */
module.exports = async function eventRegCustomWhatsAppProcessor(
    event,
    recipients,
    customMessage = {}
) {
    const eventId = event._id.toString();
    const total = recipients.length;
    const { subject, body, mediaUrl } = customMessage;

    let processed = 0;
    let sent = 0;
    let failed = 0;

    if (!total) {
        emitEmailProgress(eventId, { sent: 0, failed: 0, processed: 0, total: 0 });
        return;
    }

    const formattedMessage = formatCustomMessage(subject, body);

    for (const r of recipients) {
        processed++;

        try {
            const { reg, phone } = await resolveRecipientContext(r._id, r);
            if (!phone) {
                failed++;
                continue;
            }

            const phoneResult = formatPhoneForWhatsApp(phone);
            if (!phoneResult.formatted) {
                failed++;
                continue;
            }

            const result = await sendCustomWhatsApp(
                phoneResult.formatted,
                formattedMessage,
                mediaUrl || null
            );

            if (result.success) {
                await Registration.updateOne(
                    { _id: reg._id },
                    { whatsappSent: true }
                );
                sent++;
            } else {
                failed++;
            }
        } catch {
            failed++;
        }

        emitEmailProgress(eventId, { sent, failed, processed, total });
        await new Promise((r) => setTimeout(r, 100));
    }

    emitEmailProgress(eventId, {
        sent,
        failed,
        processed: total,
        total,
    });
};
