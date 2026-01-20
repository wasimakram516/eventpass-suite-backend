const { emitUpdate } = require("../../../utils/socketUtils");

function emitTaskCompletedUpdate(eventId, registrationId, tasksCompleted, maxTasks) {
    emitUpdate("digipassTaskCompletedUpdate", {
        eventId,
        registrationId,
        tasksCompleted,
        maxTasks,
    });
}

function emitUploadProgress(eventId, uploaded, total) {
    emitUpdate("digipassRegistrationUploadProgress", {
        eventId,
        uploaded,
        total,
    });
}

function emitNewRegistration(eventId, registrationData) {
    emitUpdate("digipassRegistrationNew", {
        eventId,
        registration: registrationData,
    });
}

function emitWalkInNew(eventId, registrationId, walkInData) {
    emitUpdate("digipassWalkInNew", {
        eventId,
        registrationId,
        walkIn: walkInData,
    });
}

module.exports = {
    emitTaskCompletedUpdate,
    emitUploadProgress,
    emitNewRegistration,
    emitWalkInNew,
};

