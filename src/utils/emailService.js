const nodemailer = require('nodemailer');

const transporter = nodemailer.createTransport({
  service: 'Gmail',
  auth: {
    user: process.env.EMAIL_USER,
    pass: process.env.EMAIL_PASS
  }
});

/**
 * Sends email with optional QR code image attachment (base64 PNG)
 */
const sendEmail = async (to, subject, html, qrCodeBase64 = null) => {
  const mailOptions = {
    from: `"EventPass" <${process.env.EMAIL_USER}>`,
    to,
    subject,
    html,
    attachments: []
  };

  if (qrCodeBase64) {
    mailOptions.attachments.push({
      filename: 'qrcode.png',
      content: qrCodeBase64.split("base64,")[1],
      encoding: 'base64',
      cid: 'qrcode' 
    });
  }

  if (qrCodeBase64) {
    mailOptions.html = html.replace(
      '{{qrImage}}',
      `<img src="cid:qrcode" alt="QR Code" style="width:250px;" />`
    );
  }

  try {
    await transporter.sendMail(mailOptions);
    return true;
  } catch (err) {
    console.error("Email error:", err);
    return false;
  }
};

module.exports = sendEmail;
