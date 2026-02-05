const Registration = require("../../models/Registration");
const Event = require("../../models/Event");
const { emitUploadProgress, emitUploadComplete } = require("../../socket/modules/checkin/checkInSocket");
const {
  pickEmail,
  pickPhone,
} = require("../../utils/customFieldUtils");
const { normalizePhone } = require("../../utils/whatsappProcessorUtils");
const {
  extractCountryCodeAndIsoCode,
  combinePhoneWithCountryCode,
  getCountryByCode,
  DEFAULT_ISO_CODE,
} = require("../../utils/countryCodes");

function formatRowNumbers(arr) {
  if (arr.length === 0) return "";
  if (arr.length === 1) return arr[0].toString();
  if (arr.length === 2) return `${arr[0]} and ${arr[1]}`;
  return `${arr.slice(0, -1).join(", ")}, and ${arr[arr.length - 1]}`;
}

module.exports = async function uploadProcessor(event, rows, user) {
  const eventId = event._id.toString();
  const total = rows.length;
  let processed = 0;
  let imported = 0;
  let skipped = 0;
  const duplicateRowNumbers = [];

  const CHUNK_SIZE = 100;

  try {
    for (let i = 0; i < rows.length; i += CHUNK_SIZE) {
      const chunk = rows.slice(i, i + CHUNK_SIZE);

      for (let chunkIndex = 0; chunkIndex < chunk.length; chunkIndex++) {
        const row = chunk[chunkIndex];
        processed++;
        const rowNumber = i + chunkIndex + 2;

        try {
          const hasCustomFields = event.formFields && event.formFields.length > 0;
          let registrationData = {
            eventId,
            token: row["Token"] || undefined,
            approvalStatus: "pending",
          };

          let extractedEmail = null;
          let extractedPhone = null;

          let phoneIsoCode = null;
          let phoneLocalNumber = null;
          let phoneForDuplicateCheck = null;

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
                    phoneForDuplicateCheck = normalizedPhone;
                  } else {
                    phoneLocalNumber = normalizedPhone;
                    extractedIsoCode = extractedIsoCode || DEFAULT_ISO_CODE;
                    phoneForDuplicateCheck = combinePhoneWithCountryCode(phoneLocalNumber, extractedIsoCode) || normalizedPhone;
                  }
                } else {
                  phoneLocalNumber = normalizedPhone;
                  extractedIsoCode = extractedIsoCode || DEFAULT_ISO_CODE;
                  phoneForDuplicateCheck = combinePhoneWithCountryCode(phoneLocalNumber, extractedIsoCode) || normalizedPhone;
                }

                customFields[phoneField.inputName] = phoneLocalNumber;
                phoneIsoCode = extractedIsoCode;
                break;
              }
            }

            registrationData.customFields = customFields;
            registrationData.isoCode = phoneIsoCode || null;

            const formFields = event.formFields || [];
            const emailField = formFields.find((f) => f.inputType === "email");
            if (emailField && customFields[emailField.inputName]) {
              extractedEmail = customFields[emailField.inputName];
            } else {
              extractedEmail = pickEmail(customFields);
            }
            extractedPhone = phoneForDuplicateCheck || pickPhone(customFields);
          } else {
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
                  phoneForDuplicateCheck = normalizedPhone;
                } else {
                  phoneLocalNumber = normalizedPhone;
                  extractedIsoCode = extractedIsoCode || DEFAULT_ISO_CODE;
                  phoneForDuplicateCheck = combinePhoneWithCountryCode(phoneLocalNumber, extractedIsoCode) || normalizedPhone;
                }
              } else {
                phoneLocalNumber = normalizedPhone;
                extractedIsoCode = extractedIsoCode || DEFAULT_ISO_CODE;
                phoneForDuplicateCheck = combinePhoneWithCountryCode(phoneLocalNumber, extractedIsoCode) || normalizedPhone;
              }

              phoneIsoCode = extractedIsoCode;
            }

            registrationData.fullName = fullName;
            registrationData.email = email;
            registrationData.phone = phoneLocalNumber || phone;
            registrationData.isoCode = phoneIsoCode || null;
            registrationData.company = company;
            registrationData.customFields = {};

            extractedEmail = email;
            extractedPhone = phoneForDuplicateCheck || phone;
          }

          const duplicateFilter = { eventId, isDeleted: { $ne: true } };
          const or = [];

          if (extractedEmail) {
            if (hasCustomFields) {
              const emailField = event.formFields.find((f) => f.inputType === "email");
              if (emailField) {
                or.push({ [`customFields.${emailField.inputName}`]: extractedEmail });
              }
            }
            or.push({ email: extractedEmail });
          }

          if (extractedPhone) {
            const phoneForDupCheck = phoneForDuplicateCheck || extractedPhone;
            if (hasCustomFields) {
              const phoneField = event.formFields.find((f) =>
                f.inputType === "phone" ||
                f.inputName?.toLowerCase().includes("phone")
              );
              if (phoneField) {

                or.push({ [`customFields.${phoneField.inputName}`]: phoneLocalNumber || extractedPhone });
                or.push({ [`customFields.${phoneField.inputName}`]: phoneForDupCheck });
              }
            }
            or.push({ phone: phoneLocalNumber || extractedPhone });
            or.push({ phone: phoneForDupCheck });
          }

          if (or.length > 0) {
            duplicateFilter.$or = or;
            const existing = await Registration.findOne(duplicateFilter);
            if (existing) {
              duplicateRowNumbers.push(rowNumber);
              skipped++;
              continue;
            }
          }

          if (user) {
            await Registration.createWithAuditUser(registrationData, user);
          } else {
            await Registration.create(registrationData);
          }
          imported++;
        } catch (err) {
          skipped++;
        }

        emitUploadProgress(eventId, processed, total);
      }

      await new Promise((r) => setTimeout(r, 15));
    }

    emitUploadProgress(eventId, total, total);

    await Event.findByIdAndUpdate(eventId, {
      $inc: { registrations: imported },
    });

    let duplicateMessage = null;
    if (duplicateRowNumbers.length > 0) {
      const rowNumbersText = formatRowNumbers(duplicateRowNumbers);
      duplicateMessage = `Row${duplicateRowNumbers.length > 1 ? "s" : ""} ${rowNumbersText} ${duplicateRowNumbers.length > 1 ? "are" : "is"} already existing and ${duplicateRowNumbers.length > 1 ? "were" : "was"} skipped.`;
    }

    emitUploadComplete(eventId, {
      imported,
      skipped,
      total,
      duplicateRowNumbers: duplicateRowNumbers.length > 0 ? duplicateRowNumbers : null,
      duplicateMessage,
    });

    let message = `CheckIn upload finished: Imported=${imported}, Skipped=${skipped}, Total=${total}`;
    if (duplicateMessage) {
      message += ` ${duplicateMessage}`;
    }

  } catch (err) {
    console.error("CHECKIN UPLOAD PROCESSOR ERROR:", err);
  }
};

