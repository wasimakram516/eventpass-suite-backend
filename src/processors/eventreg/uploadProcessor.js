const Registration = require("../../models/Registration");
const Event = require("../../models/Event");
const { emitUploadProgress } = require("../../socket/modules/eventreg/eventRegSocket");
const { normalizePhone } = require("../../utils/whatsappProcessorUtils");
const {
  extractCountryCodeAndIsoCode,
  combinePhoneWithCountryCode,
  getCountryByCode,
  DEFAULT_ISO_CODE,
} = require("../../utils/countryCodes");

module.exports = async function uploadProcessor(event, rows) {
  const eventId = event._id.toString();
  const total = rows.length;
  let processed = 0;
  let imported = 0;
  let skipped = 0;

  const CHUNK_SIZE = 100;

  try {
    for (let i = 0; i < rows.length; i += CHUNK_SIZE) {
      const chunk = rows.slice(i, i + CHUNK_SIZE);

      for (const row of chunk) {
        processed++;

        try {
          const hasCustomFields = event.formFields && event.formFields.length > 0;
          let registrationData = {
            eventId,
            token: row["Token"] || undefined,
          };

          if (event.requiresApproval) {
            const approvedValue = row["Approved"];
            if (approvedValue) {
              const normalizedApproved = String(approvedValue).trim().toLowerCase();
              if (normalizedApproved === "yes") {
                registrationData.approvalStatus = "approved";
              } else if (normalizedApproved === "no") {
                registrationData.approvalStatus = "rejected";
              } else {
                registrationData.approvalStatus = "pending";
              }
            } else {
              registrationData.approvalStatus = "pending";
            }
          } else {
            registrationData.approvalStatus = "approved";
          }

          let phoneIsoCode = null;
          let phoneLocalNumber = null;

          if (hasCustomFields) {
            const customFields = {};
            let missingField = null;

            const phoneFields = event.formFields.filter((f) =>
              f.inputType === "phone" || f.inputName?.toLowerCase().includes("phone")
            );

            for (const field of event.formFields) {
              const value = row[field.inputName];
              if (field.required && !value) {
                missingField = field.inputName;
                break;
              }
              if (value) customFields[field.inputName] = value;
            }

            if (missingField) {
              skipped++;
              continue;
            }

            for (const phoneField of phoneFields) {
              const phoneValue = customFields[phoneField.inputName];
              if (phoneValue) {
                const isoCodeColumnName = `${phoneField.inputName} isoCode`;
                let isoCodeFromFile = row[isoCodeColumnName] || row["isoCode"] || null;

                if (isoCodeFromFile && isoCodeFromFile.startsWith("+")) {
                  const country = getCountryByCode(isoCodeFromFile);
                  if (country) {
                    isoCodeFromFile = country.isoCode;
                  }
                }

                const normalizedPhone = normalizePhone(phoneValue);
                let extractedIsoCode = isoCodeFromFile?.toLowerCase() || null;

                if (normalizedPhone.startsWith("+")) {
                  const extracted = extractCountryCodeAndIsoCode(normalizedPhone);
                  if (extracted.isoCode) {
                    phoneLocalNumber = extracted.localNumber;
                    extractedIsoCode = extracted.isoCode;
                  } else {
                    phoneLocalNumber = normalizedPhone;
                    extractedIsoCode = extractedIsoCode || DEFAULT_ISO_CODE;
                  }
                } else {
                  phoneLocalNumber = normalizedPhone;
                  extractedIsoCode = extractedIsoCode || DEFAULT_ISO_CODE;
                }

                customFields[phoneField.inputName] = phoneLocalNumber;
                phoneIsoCode = extractedIsoCode;
                break;
              }
            }

            registrationData.customFields = customFields;
            registrationData.isoCode = phoneIsoCode || null;
          } else {
            // Case: No custom fields - use classic fields
            const fullName = row["Full Name"];
            const email = row["Email"];
            const phone = row["Phone"] || null;
            const company = row["Company"] || null;
            let isoCodeFromFile = row["isoCode"] || row["Phone isoCode"] || null;

            if (isoCodeFromFile && isoCodeFromFile.startsWith("+")) {
              const country = getCountryByCode(isoCodeFromFile);
              if (country) {
                isoCodeFromFile = country.isoCode;
              }
            }

            if (!fullName || !email) {
              skipped++;
              continue;
            }

            if (phone) {
              const normalizedPhone = normalizePhone(phone);
              let extractedIsoCode = isoCodeFromFile?.toLowerCase() || null;

              if (normalizedPhone.startsWith("+")) {
                const extracted = extractCountryCodeAndIsoCode(normalizedPhone);
                if (extracted.isoCode) {
                  phoneLocalNumber = extracted.localNumber;
                  extractedIsoCode = extracted.isoCode;
                } else {
                  phoneLocalNumber = normalizedPhone;
                  extractedIsoCode = extractedIsoCode || DEFAULT_ISO_CODE;
                }
              } else {
                phoneLocalNumber = normalizedPhone;
                extractedIsoCode = extractedIsoCode || DEFAULT_ISO_CODE;
              }

              phoneIsoCode = extractedIsoCode;
            }

            registrationData.fullName = fullName;
            registrationData.email = email;
            registrationData.phone = phoneLocalNumber || phone;
            registrationData.isoCode = phoneIsoCode || null;
            registrationData.company = company;
            registrationData.customFields = {};
          }

          await Registration.create(registrationData);
          imported++;
        } catch (err) {
          skipped++;
        }

        emitUploadProgress(eventId, processed, total);
      }

      // Non-blocking
      await new Promise(r => setTimeout(r, 15));
    }

    emitUploadProgress(eventId, total, total);

    // update event count
    await Event.findByIdAndUpdate(eventId, {
      $inc: { registrations: imported }
    });

    console.log(
      `Upload finished: Imported=${imported}, Skipped=${skipped}, Total=${total}`
    );

  } catch (err) {
    console.error("UPLOAD PROCESSOR ERROR:", err);
  }
};
