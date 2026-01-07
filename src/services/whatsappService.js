const env = require("../config/env");
const axios = require("axios");
const WhatsAppMessageLog = require("../models/WhatsAppMessageLog");
const {
  emitWhatsAppOutboundMessage,
} = require("../socket/modules/notifications/whatsappSocket");

const sendTwilioWhatsApp = async ({ to, payload, meta = {} }) => {
  const attemptedAt = new Date();

  const { baseUrl, accountSSID, username, password, from } =
    env.notifications.whatsapp;

  const url = `${baseUrl}/Accounts/${accountSSID}/Messages.json`;

  const formData = new URLSearchParams();
  formData.append("From", from);
  formData.append("To", to);
  formData.append(
    "StatusCallback",
    `${env.server.backendUrl}/api/webhooks/twilio/whatsapp/status`
  );

  Object.entries(payload).forEach(([key, value]) => {
    if (value !== null && value !== undefined) {
      formData.append(key, value);
    }
  });

  try {
    const response = await axios.post(url, formData.toString(), {
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      auth: { username, password },
    });

    const log = await WhatsAppMessageLog.create({
      ...meta,

      /* ===== Direction & type ===== */
      direction: "outbound",
      type: payload.ContentSid ? "template" : "custom",

      /* ===== Addressing ===== */
      from,
      to,

      /* ===== Content ===== */
      contentSid: payload.ContentSid || null,
      contentVariables: payload.ContentVariables
        ? JSON.parse(payload.ContentVariables)
        : null,
      body: payload.Body || null,
      mediaUrls: payload.MediaUrl ? [payload.MediaUrl] : [],

      /* ===== Delivery state ===== */
      status: "queued",
      attemptedAt,
      sentAt: new Date(),

      /* ===== Twilio identifiers ===== */
      messageSid: response.data.sid,

      /* ===== Debug ===== */
      rawResponse: response.data,
    });

    emitWhatsAppOutboundMessage(meta.eventId, {
      logId: log._id,
      to: log.to,
      from: log.from,

      body: log.body,
      direction: "outbound",
      status: log.status,

      createdAt: log.createdAt,
    });

    return {
      success: true,
      messageSid: log.messageSid,
      response: response.data,
    };
  } catch (err) {
    const res = err.response;

    const log = await WhatsAppMessageLog.create({
      ...meta,

      direction: "outbound",
      type: payload.ContentSid ? "template" : "custom",

      from,
      to,

      contentSid: payload.ContentSid || null,
      contentVariables: payload.ContentVariables
        ? JSON.parse(payload.ContentVariables)
        : null,
      body: payload.Body || null,
      mediaUrls: payload.MediaUrl ? [payload.MediaUrl] : [],

      /* ===== Failure state ===== */
      status: "failed",
      attemptedAt,
      failedAt: new Date(),

      /* ===== Twilio error ===== */
      errorCode: res?.data?.error_code?.toString() || null,
      errorMessage: res?.data?.message || err.message,

      rawResponse: res?.data || null,
    });

    return {
      success: false,
      messageSid: log.messageSid,
      error: err.message,
      response: res?.data,
    };
  }
};

const sendWhatsApp = (to, contentVariables, contentSid, meta = {}) =>
  sendTwilioWhatsApp({
    to,
    payload: {
      ContentSid: contentSid,
      ContentVariables: JSON.stringify(contentVariables),
    },
    meta,
  });

const sendCustomWhatsApp = (to, mediaUrl = null, body, meta = {}) =>
  sendTwilioWhatsApp({
    to,
    payload: {
      Body: body,
      MediaUrl: mediaUrl,
    },
    meta,
  });

module.exports = {
  sendWhatsApp,
  sendCustomWhatsApp,
};
