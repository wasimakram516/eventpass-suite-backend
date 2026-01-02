const Registration = require("../../models/Registration");
const Business = require("../../models/Business");

const {
    sendWhatsApp,
    sendCustomWhatsApp,
} = require("../../services/whatsappService");

const {
    resolveRecipientContext,
    formatPhoneForWhatsApp,
} = require("../../utils/whatsappProcessorUtils");

const QRCode = require("qrcode");
const { uploadToS3 } = require("../../utils/s3Storage");
const env = require("../../config/env");

const {
    emitEmailProgress,
} = require("../../socket/modules/eventreg/eventRegSocket");

/* ---------- helpers ---------- */
const formatDateForWhatsApp = (date) => {
    if (!date) return "";
    const d = new Date(date);

    const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
    const weekdays = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

    return `${weekdays[d.getDay()]}, ${d.getDate()} ${months[d.getMonth()]} ${d.getFullYear()}`;
};

/* ---------- processor ---------- */
module.exports = async function eventRegWhatsAppProcessor(
    event,
    recipients
) {
    const eventId = event._id.toString();
    const total = recipients.length;

    let processed = 0;
    let sent = 0;
    let failed = 0;

    if (!total) {
        emitEmailProgress(eventId, { sent: 0, failed: 0, processed: 0, total: 0 });
        return;
    }

    const business = await Business.findById(event.businessId).lean();
    if (!business) {
        console.error("Business not found:", eventId);
        return;
    }

    const s = new Date(event.startDate);
    const e = event.endDate && new Date(event.endDate);
    const startStr = formatDateForWhatsApp(s);
    const endStr =
        e && e.getTime() !== s.getTime()
            ? formatDateForWhatsApp(e)
            : null;

    const dateStr = endStr ? `${startStr} to ${endStr}` : startStr;
    const eventregSSID = env.notifications.whatsapp.eventregSSID;

    for (const r of recipients) {
        processed++;

        try {
            const { reg, phone, fullName } =
                await resolveRecipientContext(r._id, r);

            if (!phone) {
                failed++;
                continue;
            }

            const phoneResult = formatPhoneForWhatsApp(phone);
            if (!phoneResult.formatted) {
                failed++;
                continue;
            }

            const displayName = fullName || "Guest";

            const contentVariables = {
                "1": displayName,
                "2": event.name,
                "3": dateStr,
                "4": event.venue || "",
                "5": event.organizerEmail || business.contactEmail || "connect@whitewall.om",
                "6": event.organizerPhone || business.contactPhone || "+96877121757",
                "7": event.organizerName || "WhiteWall Digital Solutions",
            };

            const templateResult = await sendWhatsApp(
                phoneResult.formatted,
                contentVariables,
                eventregSSID
            );

            if (!templateResult.success) {
                failed++;
                continue;
            }

            await new Promise((r) => setTimeout(r, 500));

            const qrDataUrl = await QRCode.toDataURL(reg.token);
            const qrBuffer = Buffer.from(
                qrDataUrl.replace(/^data:image\/png;base64,/, ""),
                "base64"
            );

            const { fileUrl } = await uploadToS3(
                {
                    buffer: qrBuffer,
                    mimetype: "image/png",
                    originalname: `qrcode_${reg.token}.png`,
                },
                business.slug,
                "EventReg",
                { inline: true }
            );

            const bodyText =
                `Kindly present this QR code at the event entrance for verification.\n\nYour access token is *${reg.token}*.`;

            const mediaResult = await sendCustomWhatsApp(
                phoneResult.formatted,
                fileUrl,
                bodyText
            );

            if (mediaResult.success) {
                await Registration.updateOne(
                    { _id: reg._id },
                    { whatsappSent: true }
                );
                sent++;
            } else {
                failed++;
            }
        } catch (err) {
            console.error("EventReg WhatsApp error:", err);
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
