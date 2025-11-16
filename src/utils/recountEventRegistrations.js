const Registration = require("../models/Registration");
const Event = require("../models/Event");

async function recountEventRegistrations(eventId) {
  const realCount = await Registration.countDocuments({
    eventId,
    isDeleted: { $ne: true }
  });

  await Event.findByIdAndUpdate(eventId, { registrations: realCount });

  return realCount;
}

module.exports = recountEventRegistrations;
