const env = require("../config/env");
const axios = require("axios");

/**
 * Sends a WhatsApp message using Twilio API.
 */
const sendWhatsApp = async (to, contentVariables) => {
    try {
        const baseUrl = env.notifications.whatsapp.baseUrl;
        const accountSSID = env.notifications.whatsapp.accountSSID;
        const username = env.notifications.whatsapp.username;
        const password = env.notifications.whatsapp.password;
        const from = env.notifications.whatsapp.from;
        const contentSSID = env.notifications.whatsapp.contentSSID;

        const url = `${baseUrl}/Accounts/${accountSSID}/Messages.json`;

        const formData = new URLSearchParams();
        formData.append("From", from);
        formData.append("To", to);
        formData.append("ContentSid", contentSSID);
        formData.append("ContentVariables", JSON.stringify(contentVariables));

        const response = await axios.post(url, formData.toString(), {
            headers: {
                "Content-Type": "application/x-www-form-urlencoded",
            },
            auth: {
                username,
                password,
            },
        });

        const success = response.status >= 200 && response.status < 300;
        if (success) {
            console.log(`WhatsApp sent to ${to}: ${response.status}`);
        } else {
            console.error(`Failed to send WhatsApp to ${to}: ${response.status}`);
        }

        return {
            success,
            response: response.data,
            code: response.status,
        };
    } catch (err) {
        console.error("WhatsApp send error:", err.message);
        return {
            success: false,
            error: err.message,
            code: err.response?.status || 500,
            response: err.response?.data,
        };
    }
};

module.exports = sendWhatsApp;

