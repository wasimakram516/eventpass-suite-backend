const Registration = require("../models/Registration");
const Event = require("../models/Event");
const DigiPassParticipationLog = require("../models/DigiPassParticipationLog");

async function recountEventRegistrations(eventId) {
  const event = await Event.findById(eventId).select("linkedEventRegId").lean();

  let realCount;
  if (event?.linkedEventRegId) {
    // Linked DigiPass event — count participation logs, not registrations
    realCount = await DigiPassParticipationLog.countDocuments({ digipassEventId: eventId });
  } else {
    realCount = await Registration.countDocuments({
      eventId,
      isDeleted: { $ne: true },
    });
  }

  await Event.findByIdAndUpdate(eventId, { registrations: realCount });

  return realCount;
}

module.exports = recountEventRegistrations;
