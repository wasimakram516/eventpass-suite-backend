const Registration = require("../../models/Registration");
const Business = require("../../models/Business");

const { sendWhatsApp } = require("../../services/whatsappService");

const {
  resolveRecipientContext,
  formatPhoneForWhatsApp,
} = require("../../utils/whatsappProcessorUtils");

const {
  emitEmailProgress,
} = require("../../socket/modules/checkin/checkInSocket");

/**
 * Format date for WhatsApp template
 */
const formatDateForWhatsApp = (date) => {
  if (!date) return "";

  const d = new Date(date);
  const months = [
    "Jan",
    "Feb",
    "Mar",
    "Apr",
    "May",
    "Jun",
    "Jul",
    "Aug",
    "Sep",
    "Oct",
    "Nov",
    "Dec",
  ];
  const weekdays = [
    "Sunday",
    "Monday",
    "Tuesday",
    "Wednesday",
    "Thursday",
    "Friday",
    "Saturday",
  ];

  return `${weekdays[d.getDay()]}, ${d.getDate()} ${
    months[d.getMonth()]
  } ${d.getFullYear()}`;
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
  const startStr = formatDateForWhatsApp(s);
  const endStr =
    e && e.getTime() !== s.getTime() ? formatDateForWhatsApp(e) : null;

  const dateStr = endStr ? `${startStr} to ${endStr}` : startStr;

  for (const r of recipients) {
    processed++;

    try {
      const { reg, phone, fullName } = await resolveRecipientContext(r._id, r);

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

      const confirmationLink = reg.token
        ? `${env.client.url}/checkin/event/${
            event.slug
          }?token=${encodeURIComponent(reg.token)}`
        : `${env.client.url}/checkin/event/${event.slug}`;

      const contentVariables = {
        1: displayName,
        2: event.name,
        3: dateStr,
        4: event.venue || "",
        5: confirmationLink,
        6: event.organizerName || "WhiteWall Digital Solutions",
      };

      const contentSSID = env.notifications.whatsapp.checkinSSID;

      const templateResult = await sendWhatsApp(
        phoneResult.formatted,
        contentVariables,
        contentSSID,
        {
          eventId: event._id,
          registrationId: reg._id,
          token: reg.token,
        }
      );

      if (!templateResult.success) {
        failed++;
        continue;
      }

      sent++;

      await Registration.updateOne({ _id: reg._id }, { whatsappSent: true });

      await new Promise((r) => setTimeout(r, 500));
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
