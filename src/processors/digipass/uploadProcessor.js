const Registration = require("../../models/Registration");
const Event = require("../../models/Event");
const { emitUploadProgress } = require("../../socket/modules/digipass/digiPassSocket");
const { normalizePhone } = require("../../utils/whatsappProcessorUtils");
const {
    extractCountryCodeAndIsoCode,
    combinePhoneWithCountryCode,
    getCountryByCode,
    DEFAULT_ISO_CODE,
} = require("../../utils/countryCodes");

module.exports = async function uploadProcessor(event, rows, user) {
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
                    const formFields = event.formFields || [];
                    let registrationData = {
                        eventId,
                        token: row["Token"] || undefined,
                        tasksCompleted: 0,
                    };

                    let phoneIsoCode = null;
                    let phoneLocalNumber = null;

                    const customFields = {};
                    let missingField = null;

                    const phoneFields = formFields.filter((f) =>
                        f.inputType === "phone" || f.inputName?.toLowerCase().includes("phone")
                    );

                    for (const field of formFields) {
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

        console.log(
            `DigiPass Upload finished: Imported=${imported}, Skipped=${skipped}, Total=${total}`
        );
    } catch (err) {
        console.error("DIGIPASS UPLOAD PROCESSOR ERROR:", err);
    }
};

