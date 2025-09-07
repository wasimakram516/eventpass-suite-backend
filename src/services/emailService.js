const nodemailer = require("nodemailer");

const transporter = nodemailer.createTransport({
  service: "Gmail",
  auth: {
    user: process.env.EMAIL_USER,
    pass: process.env.EMAIL_PASS,
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
      `<img src="cid:qrcode" alt="QR Code" style="width:250px;" />`
    );
  } else {
    // fallback remove placeholder
    html = html.replace("{{qrImage}}", "");
  }

  const mailOptions = {
    from: `"EventPass" <${process.env.EMAIL_USER}>`,
    to,
    subject,
    html,
    attachments,
  };

  try {
    await transporter.sendMail(mailOptions);
    return true;
  } catch (err) {
    console.error("Email error:", err);
    return false;
  }
};

module.exports = sendEmail;
