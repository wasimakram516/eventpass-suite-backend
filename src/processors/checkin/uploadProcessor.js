const Registration = require("../../models/Registration");
const Event = require("../../models/Event");
const { emitUploadProgress } = require("../../socket/modules/checkin/checkInSocket");

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
            approvalStatus: "pending", // For checkin module, always create with pending status
          };

          if (hasCustomFields) {
            const customFields = {};
            let missingField = null;

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

            registrationData.customFields = customFields;
          } else {
            const fullName = row["Full Name"];
            const email = row["Email"];
            const phone = row["Phone"] || null;
            const company = row["Company"] || null;
            if (!fullName || !email) {
              skipped++;
              continue;
            }

            registrationData.fullName = fullName;
            registrationData.email = email;
            registrationData.phone = phone;
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

      await new Promise((r) => setTimeout(r, 15));
    }

    emitUploadProgress(eventId, total, total);

    await Event.findByIdAndUpdate(eventId, {
      $inc: { registrations: imported },
    });

    console.log(
      `CheckIn upload finished: Imported=${imported}, Skipped=${skipped}, Total=${total}`
    );
  } catch (err) {
    console.error("CHECKIN UPLOAD PROCESSOR ERROR:", err);
  }
};

