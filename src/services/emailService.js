const nodemailer = require("nodemailer");
const env = require("../config/env");

// Create a single reusable transporter instance
const transporter = nodemailer.createTransport({
  host: env.notifications.email.host, // smtp.sendgrid.net
  port: env.notifications.email.port, // 587
  secure: false, // SendGrid requires STARTTLS, not SSL
  auth: {
    user: env.notifications.email.user, // usually "apikey"
    pass: env.notifications.email.pass, // actual API key
  },
  pool: true, // enable connection pooling
  maxConnections: 5, // keep low for small EC2
  maxMessages: 1000, // rotate after this many messages
});

/**
 * Sends an email using SendGrid SMTP.
 * Supports inline QR code using {{qrImage}} placeholder and additional attachments.
 *
 * @param {string} to
 * @param {string} subject
 * @param {string} html
 * @param {string|null} qrCodeBase64
 * @param {Array} extraAttachments
 */
const sendEmail = async (
  to,
  subject,
  html,
  qrCodeBase64 = null,
  extraAttachments = []
) => {
  try {
    const attachments = [...extraAttachments];

    // Inline QR attachment if provided
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
      html = html.replace("{{qrImage}}", "");
    }

    const mailOptions = {
      from: env.notifications.email.from,
      to,
      subject,
      html,
      attachments,
    };

    const info = await transporter.sendMail(mailOptions);

    const smtpResponse = info?.response || "";
    const smtpCode = parseInt(smtpResponse.split(" ")[0]) || 0;
    const accepted = info?.accepted?.length > 0;

    const success = accepted || (smtpCode >= 200 && smtpCode < 300);
    if (success) {
      console.log(`Email sent to ${to}: ${smtpResponse}`);
    } else {
      console.error(`Failed to send email to ${to}: ${smtpResponse}`);
    }
    return {
      success,
      response: smtpResponse,
      accepted: info.accepted || [],
      rejected: info.rejected || [],
      code: smtpCode,
    };
  } catch (err) {
    return {
      success: false,
      error: err.message,
      code: err.responseCode || 500,
    };
  }
};

module.exports = sendEmail;
