const Registration = require("../../models/Registration");
const Business = require("../../models/Business");
const sendWhatsApp = require("../../services/whatsappService");
const { sendWhatsAppWithMedia } = require("../../services/whatsappService");
const { pickPhone, pickFullName } = require("../../utils/customFieldUtils");
const QRCode = require("qrcode");
const { uploadToS3 } = require("../../utils/s3Storage");
const env = require("../../config/env");

const {
    emitEmailProgress,
} = require("../../socket/modules/eventreg/eventRegSocket");

/**
 * Format date for WhatsApp template (e.g., "Monday, 24 Jan 2026")
 * Always uses English format as templates are approved for English only
 */
const formatDateForWhatsApp = (date) => {
    if (!date) return "";
    const d = new Date(date);
    const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
    const weekdays = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

    const weekday = weekdays[d.getDay()];
    const day = d.getDate();
    const month = months[d.getMonth()];
    const year = d.getFullYear();

    return `${weekday}, ${day} ${month} ${year}`;
};

/**
 * Validate phone number
 */
const validatePhoneNumber = (phone) => {
    if (!phone) return { valid: false, error: "Phone number is required" };

    const phoneStr = String(phone).trim();

    if (!phoneStr.startsWith("+")) {
        return { valid: false, error: "Phone number must start with country code (e.g., +92, +968, +1)" };
    }

    const digits = phoneStr.replace(/\D/g, "");

    if (phoneStr.startsWith("+92")) {
        const localDigits = digits.replace(/^92/, "");
        if (localDigits.length !== 10) {
            return { valid: false, error: "Pakistan phone number must be 10 digits (excluding country code +92)" };
        }
        return { valid: true };
    }

    if (phoneStr.startsWith("+968")) {
        const localDigits = digits.replace(/^968/, "");
        if (localDigits.length !== 8) {
            return { valid: false, error: "Oman phone number must be 8 digits (excluding country code +968)" };
        }
        return { valid: true };
    }

    if (digits.length < 8) {
        return { valid: false, error: "Phone number is too short" };
    }
    if (digits.length > 15) {
        return { valid: false, error: "Phone number is too long" };
    }

    return { valid: true };
};

/**
 * Format phone number to WhatsApp format
 */
const formatPhoneForWhatsApp = (phone) => {
    if (!phone) return { formatted: null, error: "Phone number is required" };

    let phoneStr = String(phone).trim();

    const validation = validatePhoneNumber(phoneStr);
    if (!validation.valid) {
        return { formatted: null, error: validation.error };
    }

    return {
        formatted: `whatsapp:${phoneStr}`,
        error: null,
    };
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
                `EventReg bulk notification finished: 0 sent, 0 failed, total 0`
            );
            return;
        }

        // Templates are strictly English only
        const business = await Business.findById(event.businessId).lean();
        if (!business) {
            console.error("Business not found for event:", eventId);
            return;
        }

        const s = new Date(event.startDate);
        const e = event.endDate && new Date(event.endDate);
        const startStr = formatDateForWhatsApp(s);
        const endStr = e && e.getTime() !== s.getTime() ? formatDateForWhatsApp(e) : null;
        const dateStr = endStr ? `${startStr} to ${endStr}` : startStr;

        const eventregSSID = process.env.EVENTREG_WHATSAPP_SSID;
        if (!eventregSSID) {
            console.error("EVENTREG_WHATSAPP_SSID not found in environment variables");
            emitEmailProgress(eventId, {
                sent: 0,
                failed: total,
                processed: total,
                total,
            });
            return;
        }

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
                const displayName = fullName || "Guest";

                const phoneResult = formatPhoneForWhatsApp(phone);
                if (!phoneResult.formatted) {
                    console.error(`Invalid phone number for registration ${reg._id}: ${phoneResult.error}`);
                    failed++;
                    continue;
                }
                const formattedPhone = phoneResult.formatted;

                const organizerEmail = event.organizerEmail || business.contactEmail || "connect@whitewall.om";
                const organizerPhone = event.organizerPhone || business.contactPhone || "+96877121757";
                const organizerName = event.organizerName || "WhiteWall Digital Solutions";

                const contentVariables = {
                    "1": displayName,
                    "2": event.name,
                    "3": dateStr,
                    "4": event.venue || "",
                    "5": organizerEmail,
                    "6": organizerPhone,
                    "7": organizerName,
                };

                const result = await sendWhatsApp(formattedPhone, contentVariables, eventregSSID);

                if (!result.success) {
                    failed++;
                    continue;
                }

                await new Promise((r) => setTimeout(r, 500));

                try {
                    const qrCodeDataUrl = await QRCode.toDataURL(reg.token);
                    const base64Data = qrCodeDataUrl.replace(/^data:image\/png;base64,/, "");
                    const qrCodeBuffer = Buffer.from(base64Data, "base64");

                    const fileObject = {
                        buffer: qrCodeBuffer,
                        mimetype: "image/png",
                        originalname: `qrcode_${reg.token}.png`,
                    };

                    const { fileUrl } = await uploadToS3(fileObject, business.slug, "Eventreg", { inline: true });


                    const bodyText = `Kindly present this QR code at the event entrance for verification.\n\nYour access token is *${reg.token}*.`;

                    const mediaResult = await sendWhatsAppWithMedia(formattedPhone, fileUrl, bodyText);

                    if (mediaResult.success) {
                        await Registration.updateOne({ _id: r._id }, { whatsappSent: true });
                        sent++;
                    } else {
                        failed++;
                    }
                } catch (mediaErr) {
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
            `EventReg bulk notification finished: ${sent} sent, ${failed} failed, total ${total}`
        );
    } catch (err) {
        console.error("EVENTREG WHATSAPP PROCESSOR ERROR:", err);
    }
};

