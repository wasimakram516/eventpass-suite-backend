function buildCustomEmail({
  event,
  subject,
  bodyHtml,
}) {
  const targetLang = event.defaultLanguage || "en";
  const dir = targetLang === "ar" ? "rtl" : "ltr";

  const headerText = event.name; 

  const html = `
    <div dir="${dir}" style="font-family:'Segoe UI',Arial,sans-serif;background:#f6f8fa;padding:20px;">
      <div style="max-width:640px;margin:auto;background:#ffffff;border-radius:12px;overflow:hidden;box-shadow:0 4px 12px rgba(0,0,0,0.05);">
        
        <!-- HEADER -->
        <div style="background:#004aad;padding:24px;text-align:center;">
          ${event.logoUrl
            ? `<img src="${event.logoUrl}" alt="Event Logo" style="max-width:140px;max-height:80px;margin-bottom:10px;" />`
            : ""
          }
          <h2 style="color:#fff;font-size:22px;margin:0;">
            ${headerText}
          </h2>
        </div>

        <!-- BODY -->
        <div style="padding:24px 28px 28px;">
          ${bodyHtml}
        </div>
      </div>
    </div>
  `;

  return {
    subject, 
    html,
    qrCodeDataUrl: null,
  };
}

module.exports = { buildCustomEmail };
