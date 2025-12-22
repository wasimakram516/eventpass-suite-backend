const { emitUpdate } = require("../../../utils/socketUtils");

function emitUploadProgress(eventId, uploaded, total) {
    emitUpdate("checkinRegistrationUploadProgress", {
        eventId,
        uploaded,
        total,
    });
}

function emitEmailProgress(eventId, payload) {
    emitUpdate("checkinRegistrationEmailProgress", {
        eventId,
        ...payload,
    });
}

function emitLoadingProgress(eventId, loaded, total, data = null) {
    emitUpdate("checkinRegistrationLoadingProgress", {
        eventId,
        loaded,
        total,
        ...(data && { data }),
    });
}

function emitNewRegistration(eventId, registrationData) {
    emitUpdate("checkinRegistrationNew", {
        eventId,
        registration: registrationData,
    });
}

function emitPresenceConfirmed(eventId, registrationData) {
    emitUpdate("checkinRegistrationPresenceConfirmed", {
        eventId,
        registration: registrationData,
    });
}

module.exports = {
    emitUploadProgress,
    emitEmailProgress,
    emitLoadingProgress,
    emitNewRegistration,
    emitPresenceConfirmed,
};

