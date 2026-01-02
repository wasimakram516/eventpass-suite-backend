const env = require("../config/env");
const axios = require("axios");

const sendTwilioWhatsApp = async ({ to, payload }) => {
  try {
    const { baseUrl, accountSSID, username, password, from } =
      env.notifications.whatsapp;

    const url = `${baseUrl}/Accounts/${accountSSID}/Messages.json`;

    const formData = new URLSearchParams();
    formData.append("From", from);
    formData.append("To", to);

    Object.entries(payload).forEach(([key, value]) => {
      if (value !== null && value !== undefined) {
        formData.append(key, value);
      }
    });

    const response = await axios.post(url, formData.toString(), {
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      auth: { username, password },
    });

    return {
      success: true,
      code: response.status,
      response: response.data,
    };
  } catch (err) {
    return {
      success: false,
      code: err.response?.status || 500,
      error: err.message,
      response: err.response?.data,
    };
  }
};

const sendWhatsApp = (to, contentVariables, customContentSSID) =>
  sendTwilioWhatsApp({
    to,
    payload: {
      ContentSid: customContentSSID,
      ContentVariables: JSON.stringify(contentVariables),
    },
  });

const sendCustomWhatsApp = (to, mediaUrl = null, body) =>
  sendTwilioWhatsApp({
    to,
    payload: {
      Body: body,
      MediaUrl: mediaUrl,
    },
  });


module.exports = {
  sendWhatsApp,
  sendCustomWhatsApp,
};
