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

module.exports = {
    emitTaskCompletedUpdate,
    emitUploadProgress,
};

