const Registration = require("../../models/Registration");
const sendWhatsApp = require("../../services/whatsappService");
const { pickPhone, pickFullName } = require("../../utils/customFieldUtils");

const {
    emitEmailProgress,
} = require("../../socket/modules/checkin/checkInSocket");

/**
 * Format date for WhatsApp template (e.g., "Monday, 24 Jan 2026")
 */
const formatDateForWhatsApp = (date, lang = "en") => {
    if (!date) return "";
    const d = new Date(date);
    const months = {
        en: ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"],
        ar: ["يناير", "فبراير", "مارس", "أبريل", "مايو", "يونيو", "يوليو", "أغسطس", "سبتمبر", "أكتوبر", "نوفمبر", "ديسمبر"]
    };
    const weekdays = {
        en: ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"],
        ar: ["الأحد", "الإثنين", "الثلاثاء", "الأربعاء", "الخميس", "الجمعة", "السبت"]
    };

    const weekday = weekdays[lang][d.getDay()];
    const day = d.getDate();
    const month = months[lang][d.getMonth()];
    const year = d.getFullYear();

    if (lang === "ar") {
        return `${weekday}, ${day} ${month} ${year}`;
    }
    return `${weekday}, ${day} ${month} ${year}`;
};

/**
 * Format phone number to WhatsApp format
 */
const formatPhoneForWhatsApp = (phone) => {
    if (!phone) return null;
    let cleaned = phone.trim();
    if (!cleaned.startsWith("+")) {
        const digits = cleaned.replace(/\D/g, "");
        if (digits.length === 0) return null;
        return `whatsapp:+${digits}`;
    }
    cleaned = cleaned.replace(/[^\d+]/g, "");
    if (cleaned.length <= 1) return null;
    return `whatsapp:${cleaned}`;
};

module.exports = async function whatsappProcessor(
    event,
    recipients
) {
    const eventId = event._id.toString();
    const total = recipients.length;

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
            console.log(
                `CheckIn bulk WhatsApp finished: 0 sent, 0 failed, total 0`
            );
            return;
        }

        const targetLang = event.defaultLanguage || "en";
        const env = require("../../config/env");

        const s = new Date(event.startDate);
        const e = event.endDate && new Date(event.endDate);
        const startStr = formatDateForWhatsApp(s, targetLang);
        const endStr = e && e.getTime() !== s.getTime() ? formatDateForWhatsApp(e, targetLang) : null;
        const dateStr = endStr
            ? (targetLang === "ar" ? `${startStr} إلى ${endStr}` : `${startStr} to ${endStr}`)
            : startStr;

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

                const fullName =
                    r.fullName || reg?.fullName || pickFullName(cf) || null;
                const displayName =
                    fullName || (targetLang === "ar" ? "ضيف" : "Guest");

                const formattedPhone = formatPhoneForWhatsApp(phone);
                if (!formattedPhone) {
                    failed++;
                    continue;
                }

                const confirmationLink = reg.token
                    ? `${env.client.url}/checkin/event/${event.slug}?token=${encodeURIComponent(reg.token)}`
                    : `${env.client.url}/checkin/event/${event.slug}`;

                const contentVariables = {
                    "1": displayName,
                    "2": event.name,
                    "3": dateStr,
                    "4": event.venue || "",
                    "5": confirmationLink,
                    "6": "WhiteWall Digital Solutions",
                };

                const result = await sendWhatsApp(formattedPhone, contentVariables);

                if (result.success) {
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

        console.log(
            `CheckIn bulk WhatsApp finished: ${sent} sent, ${failed} failed, total ${total}`
        );
    } catch (err) {
        console.error("CHECKIN WHATSAPP PROCESSOR ERROR:", err);
    }
};

