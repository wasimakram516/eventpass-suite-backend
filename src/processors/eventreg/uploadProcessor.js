const Registration = require("../../models/Registration");
const Event = require("../../models/Event");
const { emitUploadProgress } = require("../../socket/modules/eventreg/eventRegSocket");

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

          await Registration.create({
            eventId,
            customFields,
            token: row["Token"] || undefined,
          });

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
