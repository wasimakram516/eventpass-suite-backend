const SpinWheelParticipant = require("../../models/SpinWheelParticipant");
const SpinWheel = require("../../models/SpinWheel");
const { emitUploadProgress } = require("../../socket/modules/eventwheel/spinWheelSocket");
const { normalizePhone } = require("../../utils/whatsappProcessorUtils");
const {
    extractCountryCodeAndIsoCode,
    getCountryByCode,
    DEFAULT_ISO_CODE,
} = require("../../utils/countryCodes");

module.exports = async function uploadProcessor(spinWheel, rows, user = null) {
    const spinWheelId = spinWheel._id.toString();
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
                    const name = row["Name"] || row["name"] || null;

                    if (!name) {
                        skipped++;
                        continue;
                    }

                    const phone = row["Phone"] || row["phone"] || null;
                    const company = row["Company"] || row["company"] || null;
                    let isoCodeFromFile = row["isoCode"] || row["Phone isoCode"] || null;

                    let phoneLocalNumber = phone;
                    let phoneIsoCode = DEFAULT_ISO_CODE;

                    if (phone) {
                        if (isoCodeFromFile && isoCodeFromFile.startsWith("+")) {
                            const country = getCountryByCode(isoCodeFromFile);
                            if (country) {
                                isoCodeFromFile = country.isoCode;
                            }
                        }

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

                    const participantData = {
                        spinWheel: spinWheelId,
                        name: name.trim(),
                        phone: phoneLocalNumber || null,
                        isoCode: phoneIsoCode,
                        company: company ? company.trim() : null,
                    };

                    if (user) {
                        await SpinWheelParticipant.createWithAuditUser(participantData, user);
                    } else {
                        await SpinWheelParticipant.create(participantData);
                    }
                    imported++;
                } catch (err) {
                    skipped++;
                }

                emitUploadProgress(spinWheelId, processed, total);
            }

            // Non-blocking
            await new Promise(r => setTimeout(r, 15));
        }

        emitUploadProgress(spinWheelId, total, total);

        console.log(
            `SpinWheel Upload finished: Imported=${imported}, Skipped=${skipped}, Total=${total}`
        );

    } catch (err) {
        console.error("SPINWHEEL UPLOAD PROCESSOR ERROR:", err);
    }
};

