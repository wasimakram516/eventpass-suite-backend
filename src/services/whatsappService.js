// utils/whatsappService.js
const twilio = require("twilio");
const env = require("../config/env");

const accountSid = env.notifications.whatsapp.accountSid;
const authToken = env.notifications.whatsapp.authToken;
const whatsappFrom = env.notifications.whatsappFrom; // e.g., 'whatsapp:+14155238886'

const client = twilio(accountSid, authToken);

const sendWhatsappMessage = async (to, body, mediaUrl = null) => {
  try {
    const message = await client.messages.create({
      from: whatsappFrom,
      to: `whatsapp:${to}`,
      body,
      ...(mediaUrl && { mediaUrl: [mediaUrl] }),
    });
    return message;
  } catch (err) {
    console.error("WhatsApp error:", err);
    return null;
  }
};

module.exports = sendWhatsappMessage;
