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

const {
    emitEmailProgress,
} = require("../../socket/modules/checkin/checkInSocket");

/**
 * Format date for WhatsApp template
 */
const formatDateForWhatsApp = (date, lang = "en") => {
    if (!date) return "";

    const d = new Date(date);
    const months = {
        en: ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"],
        ar: ["يناير", "فبراير", "مارس", "أبريل", "مايو", "يونيو", "يوليو", "أغسطس", "سبتمبر", "أكتوبر", "نوفمبر", "ديسمبر"],
    };
    const weekdays = {
        en: ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"],
        ar: ["الأحد", "الإثنين", "الثلاثاء", "الأربعاء", "الخميس", "الجمعة", "السبت"],
    };

    return `${weekdays[lang][d.getDay()]}, ${d.getDate()} ${months[lang][d.getMonth()]} ${d.getFullYear()}`;
};

module.exports = async function whatsappProcessor(event, recipients) {
    const eventId = event._id.toString();
    const total = recipients.length;

    let processed = 0;
    let sent = 0;
    let failed = 0;

    if (!total) {
        emitEmailProgress(eventId, { sent: 0, failed: 0, processed: 0, total: 0 });
        return;
    }

    const env = require("../../config/env");
    const targetLang = event.defaultLanguage || "en";

    const business = await Business.findById(event.businessId).lean();
    if (!business) {
        console.error("Business not found for event:", eventId);
        return;
    }

    const s = new Date(event.startDate);
    const e = event.endDate && new Date(event.endDate);
    const startStr = formatDateForWhatsApp(s, targetLang);
    const endStr =
        e && e.getTime() !== s.getTime()
            ? formatDateForWhatsApp(e, targetLang)
            : null;

    const dateStr = endStr
        ? targetLang === "ar"
            ? `${startStr} إلى ${endStr}`
            : `${startStr} to ${endStr}`
        : startStr;

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

            const displayName =
                fullName || (targetLang === "ar" ? "ضيف" : "Guest");

            const confirmationLink = reg.token
                ? `${env.client.url}/checkin/event/${event.slug}?token=${encodeURIComponent(reg.token)}`
                : `${env.client.url}/checkin/event/${event.slug}`;

            const contentVariables = {
                "1": displayName,
                "2": event.name,
                "3": dateStr,
                "4": event.venue || "",
                "5": confirmationLink,
                "6": event.organizerName || "WhiteWall Digital Solutions",
            };

            const contentSSID = env.notifications.whatsapp.checkinSSID;

            const templateResult = await sendWhatsApp(
                phoneResult.formatted,
                contentVariables,
                contentSSID
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
                "CheckIn",
                { inline: true }
            );

            const bodyText =
                targetLang === "ar"
                    ? `يرجى تقديم رمز QR أدناه عند مدخل الحدث للتحقق.\n\nرمز الوصول الخاص بك هو *${reg.token}*.`
                    : `Kindly present this QR code at the event entrance for verification.\n\nYour access token is *${reg.token}*.`;

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
            console.error("WhatsApp send error:", err);
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
};
