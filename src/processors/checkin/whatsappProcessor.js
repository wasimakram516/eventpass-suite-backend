const Registration = require("../../models/Registration");
const env = require("../../config/env");

const {
  sendWhatsApp,
  sendCustomWhatsApp,
} = require("../../services/whatsappService");

const {
  resolveRecipientContext,
  formatPhoneForWhatsApp,
} = require("../../utils/whatsappProcessorUtils");

const {
  emitEmailProgress,
} = require("../../socket/modules/checkin/checkInSocket");

/* =====================================================
   HELPERS – CUSTOM MESSAGE FORMATTING
===================================================== */

/**
 * Strip HTML tags from text
 */
const stripHtml = (html = "") =>
  html
    .replace(/<[^>]*>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .trim();

/**
 * Format custom WhatsApp message
 */
const formatCustomMessage = (subject, body) => {
  const cleanSubject = stripHtml(subject || "");
  const cleanBody = stripHtml(body || "");

  let message = "";
  if (cleanSubject) message = `*${cleanSubject}*\n\n`;
  if (cleanBody) message += cleanBody;

  return message.trim();
};

/* =====================================================
   HELPERS – TEMPLATE DATE FORMAT
===================================================== */

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

/* =====================================================
   SINGLE WHATSAPP PROCESSOR
===================================================== */

/**
 * @param {Object} params
 * @param {Object} params.event
 * @param {Array}  params.recipients
 * @param {"template"|"custom"} params.mode
 * @param {Object} [params.customMessage]
 */
module.exports = async function whatsappProcessor({
  event,
  recipients,
  mode = "template",
  customMessage = {},
}) {
  if (!event?._id || !event.businessId) {
    throw new Error(
      "WhatsApp processor requires valid event & business context"
    );
  }

  const eventId = event._id.toString();
  const total = recipients.length;

  let processed = 0;
  let sent = 0;
  let failed = 0;

  if (!total) {
    emitEmailProgress(eventId, { sent: 0, failed: 0, processed: 0, total: 0 });
    return;
  }

  /* ======================
     TEMPLATE PREP
  ====================== */

  let dateStr = null;
  let contentSSID = null;

  if (mode === "template") {
    const s = new Date(event.startDate);
    const e = event.endDate && new Date(event.endDate);

    const startStr = formatDateForWhatsApp(s);
    const endStr =
      e && e.getTime() !== s.getTime() ? formatDateForWhatsApp(e) : null;

    dateStr = endStr ? `${startStr} to ${endStr}` : startStr;
    contentSSID = env.notifications.whatsapp.checkinSSID;
  }

  /* ======================
     CUSTOM PREP
  ====================== */

  const formattedCustomMessage =
    mode === "custom"
      ? formatCustomMessage(customMessage.subject, customMessage.body)
      : null;

  /* ======================
     MAIN LOOP
  ====================== */

  for (const r of recipients) {
    processed++;

    try {
      const { reg, phone, isoCode, fullName } = await resolveRecipientContext(r._id, r);
      if (!reg || !phone) {
        failed++;
        continue;
      }

      const phoneResult = formatPhoneForWhatsApp(phone, isoCode);
      if (!phoneResult.formatted) {
        failed++;
        continue;
      }

      /* ======================
         SHARED META (CRITICAL)
      ====================== */

      const meta = {
        eventId: event._id,
        registrationId: reg._id,
        businessId: event.businessId,
        token: reg.token,
      };

      let result;

      /* ======================
         TEMPLATE SEND
      ====================== */

      if (mode === "template") {
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

        result = await sendWhatsApp(
          phoneResult.formatted,
          contentVariables,
          contentSSID,
          meta
        );
      }

      /* ======================
         CUSTOM SEND
      ====================== */

      if (mode === "custom") {
        result = await sendCustomWhatsApp(
          phoneResult.formatted,
          customMessage.mediaUrl || null,
          formattedCustomMessage,
          meta
        );
      }

      if (!result?.success) {
        failed++;
        continue;
      }

      sent++;
      await Registration.updateOne({ _id: reg._id }, { whatsappSent: true });
    } catch (err) {
      console.error("WhatsApp processor error:", err);
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
