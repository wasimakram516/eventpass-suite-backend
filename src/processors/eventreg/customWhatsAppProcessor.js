const Registration = require("../../models/Registration");
const { sendWhatsAppMessage } = require("../../services/whatsappService");
const { pickPhone, pickFullName } = require("../../utils/customFieldUtils");

const {
    emitEmailProgress,
} = require("../../socket/modules/eventreg/eventRegSocket");

/**
 * Format phone number to WhatsApp format
 */
const formatPhoneForWhatsApp = (phone) => {
    if (!phone) return { formatted: null, error: "Phone number is required" };

    let phoneStr = String(phone).trim();

    if (!phoneStr.startsWith("+")) {
        return { formatted: null, error: "Phone number must start with country code" };
    }

    const digits = phoneStr.replace(/\D/g, "");
    if (digits.length < 8 || digits.length > 15) {
        return { formatted: null, error: "Invalid phone number length" };
    }

    return {
        formatted: `whatsapp:${phoneStr}`,
        error: null,
    };
};

/**
 * Strip HTML tags from text
 */
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

/**
 * Format custom WhatsApp message: subject in bold, then body
 */
const formatCustomMessage = (subject, body) => {
    const cleanSubject = stripHtml(subject || "");
    const cleanBody = stripHtml(body || "");

    let message = "";
    if (cleanSubject) {
        message = `*${cleanSubject}*\n\n`;
    }
    if (cleanBody) {
        message += cleanBody;
    }

    return message.trim();
};

module.exports = async function customWhatsAppProcessor(
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

    try {
        if (total === 0) {
            emitEmailProgress(eventId, {
                sent: 0,
                failed: 0,
                processed: 0,
                total: 0,
            });
            return;
        }

        const formattedMessage = formatCustomMessage(subject, body);

        for (const r of recipients) {
            processed++;

            try {
                const reg = await Registration.findById(r._id)
                    .select("customFields fullName email phone company token _id eventId")
                    .lean();

                let cf = {};
                if (reg?.customFields) {
                    if (Array.isArray(reg.customFields)) {
                        cf = Object.fromEntries(reg.customFields);
                    } else if (typeof reg.customFields === "object") {
                        cf = reg.customFields;
                    }
                }

                const phone = r.phone || reg?.phone || pickPhone(cf) || null;
                if (!phone) {
                    failed++;
                    continue;
                }

                const phoneResult = formatPhoneForWhatsApp(phone);
                if (!phoneResult.formatted) {
                    failed++;
                    continue;
                }
                const formattedPhone = phoneResult.formatted;

                const result = await sendWhatsAppMessage(formattedPhone, formattedMessage, mediaUrl || null);

                if (result.success) {
                    await Registration.updateOne({ _id: r._id }, { whatsappSent: true });
                    sent++;
                } else {
                    failed++;
                }
            } catch (err) {
                failed++;
            }

            emitEmailProgress(eventId, {
                sent,
                failed,
                processed,
                total,
            });

            await new Promise((r) => setTimeout(r, 100));
        }

        emitEmailProgress(eventId, {
            sent,
            failed,
            processed: total,
            total,
        });
    } catch (err) {
        console.error("EVENTREG CUSTOM WHATSAPP PROCESSOR ERROR:", err);
    }
};

