const nodemailer = require("nodemailer");
env = require("../config/env");

const transporter = nodemailer.createTransport({
  host: env.notifications.email.host, // smtp.sendgrid.net
  port: env.notifications.email.port, // 587
  auth: {
    user: env.notifications.email.user, // always "apikey"
    pass: env.notifications.email.pass, // SendGrid API key
  },
});

/**
 * Sends email with optional QR code (inline) and attachments (e.g., PDFs)
 * @param {string} to - Recipient email
 * @param {string} subject - Subject line
 * @param {string} html - Email HTML (use {{qrImage}} placeholder for QR inline)
 * @param {string|null} qrCodeBase64 - QR code as dataURL (optional)
 * @param {Array} extraAttachments - Array of { filename, path|content, ... }
 */
const sendEmail = async (
  to,
  subject,
  html,
  qrCodeBase64 = null,
  extraAttachments = []
) => {
  const attachments = [...extraAttachments];

  if (qrCodeBase64) {
    attachments.push({
      filename: "qrcode.png",
      content: qrCodeBase64.split("base64,")[1],
      encoding: "base64",
      cid: "qrcode",
    });

    html = html.replace(
      "{{qrImage}}",
      `<img src="cid:qrcode" alt="QR Code" style="width:180px;display:block;margin:0 auto;" />`
    );
  } else {
    // fallback remove placeholder
    html = html.replace("{{qrImage}}", "");
  }

  const mailOptions = {
    from: env.notifications.email.from,
    to,
    subject,
    html,
    attachments,
  };

  try {
    const info = await transporter.sendMail(mailOptions);

    const smtpResponse = info?.response || "";
    const smtpCode = parseInt(smtpResponse.split(" ")[0]) || 0;
    const accepted = info?.accepted?.length > 0;

    // Success only if 250-level SMTP code or at least one accepted
    const success = accepted || (smtpCode >= 200 && smtpCode < 300);

    if (success) {
      console.log(`✅ Delivered to ${to} (${smtpResponse})`);
      return { success: true, response: smtpResponse };
    } else {
      console.warn(
        `⚠️ SendGrid did not accept email for ${to}: ${smtpResponse}`
      );
      return { success: false, response: smtpResponse, code: smtpCode };
    }
  } catch (err) {
    console.error("❌ Email error:", err);
    return {
      success: false,
      error: err.message,
      code: err.responseCode || 500,
    };
  }
};

module.exports = sendEmail;
