const { getCountryByIsoCode, COUNTRY_CODES } = require("./countryCodes");

const normalizePhone = (phone) => {
    if (!phone) return null;
    return String(phone)
        .trim()
        .replace(/\s+/g, "")
        .replace(/[()-]/g, "");
};

const validatePhoneNumberByCountry = (phone, isoCode = null) => {
    if (!phone) {
        return { valid: false, error: "Phone number is required" };
    }

    const normalizedPhone = normalizePhone(phone);
    if (!normalizedPhone) {
        return { valid: false, error: "Phone number is required" };
    }

    let country = null;
    let localNumber = null;
    let fullNumber = null;

    if (normalizedPhone.startsWith("+")) {
        const codeMatch = COUNTRY_CODES
            .filter((cc) => normalizedPhone.startsWith(cc.code))
            .sort((a, b) => b.code.length - a.code.length)[0];

        if (!codeMatch) {
            return { valid: false, error: "Invalid country code" };
        }

        country = codeMatch;
        localNumber = normalizedPhone.substring(codeMatch.code.length);
        fullNumber = normalizedPhone;
    } else {
        if (!isoCode) {
            return { valid: false, error: "Please select a country code" };
        }

        country = getCountryByIsoCode(isoCode);
        if (!country) {
            return { valid: false, error: "Invalid country code" };
        }

        localNumber = normalizedPhone;
        fullNumber = `${country.code}${localNumber}`;
    }

    const localDigits = localNumber.replace(/\D/g, "");
    const fullDigits = fullNumber.replace(/\D/g, "");

    if (localDigits.length === 0) {
        return { valid: false, error: "Phone number cannot be empty" };
    }

    if (country.digits) {
        if (typeof country.digits === "number") {
            if (localDigits.length !== country.digits) {
                return {
                    valid: false,
                    error: `${country.country} phone number must be ${country.digits} digits (excluding country code ${country.code})`,
                };
            }
        } else if (typeof country.digits === "object" && country.digits.min !== undefined) {
            const min = country.digits.min || 0;
            const max = country.digits.max || 15;
            if (localDigits.length < min || localDigits.length > max) {
                return {
                    valid: false,
                    error: `${country.country} phone number must be between ${min} and ${max} digits (excluding country code ${country.code})`,
                };
            }
        }
    }

    if (fullDigits.length < 8 || fullDigits.length > 15) {
        return { valid: false, error: "Invalid phone number length" };
    }

    return { valid: true, normalized: fullNumber, localNumber, country };
};

module.exports = {
    normalizePhone,
    validatePhoneNumberByCountry,
    validatePhoneNumber: (phone, isoCode = null) => {
        const result = validatePhoneNumberByCountry(phone, isoCode);
        if (!result.valid) {
            return { valid: false, error: result.error };
        }
        return { valid: true, normalized: result.normalized };
    },
};

