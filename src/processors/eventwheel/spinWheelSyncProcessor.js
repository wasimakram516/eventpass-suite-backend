const SpinWheel = require("../../models/SpinWheel");
const SpinWheelParticipant = require("../../models/SpinWheelParticipant");
const Registration = require("../../models/Registration");
const { pickFullName } = require("../../utils/customFieldUtils");
const { emitSpinWheelSync } = require("../../socket/modules/eventwheel/spinWheelSocket");

const WalkIn = require("../../models/WalkIn");

async function runSpinWheelSync(spinWheelId, filters = {}) {
  const wheel = await SpinWheel.findById(spinWheelId).lean();
  if (!wheel) throw new Error("SpinWheel not found");

  const { eventId } = wheel.eventSource;

  let registrationIds = [];

  // FILTER VIA WALKIN (scannedBy)
  if (Array.isArray(filters.scannedBy) && filters.scannedBy.length > 0) {
    const walkins = await WalkIn.find({
      eventId,
      scannedBy: { $in: filters.scannedBy },
      isDeleted: { $ne: true },
    }).select("registrationId");

    registrationIds = walkins.map(w => w.registrationId);
  }

  // BUILD REGISTRATION QUERY
  const registrationQuery = {
    eventId,
    isDeleted: { $ne: true },
  };

  if (registrationIds.length > 0) {
    registrationQuery._id = { $in: registrationIds };
  }

  const registrations = await Registration.find(registrationQuery).lean();
  const total = registrations.length;

  emitSpinWheelSync(spinWheelId.toString(), {
    status: "started",
    synced: 0,
    total,
  });

  // CLEAR EXISTING PARTICIPANTS (PERMANENT)
  await SpinWheelParticipant.deleteMany({ spinWheel: spinWheelId });

  let synced = 0;
  const batchSize = 100;

  for (let i = 0; i < registrations.length; i += batchSize) {
    const batch = registrations.slice(i, i + batchSize);

    const participants = batch.map((r) => {
      const name =
        r.fullName ||
        pickFullName(r.customFields) ||
        "Guest";

      return {
        name,
        spinWheel: spinWheelId,
      };
    });

    await SpinWheelParticipant.insertMany(participants);

    synced += participants.length;

    emitSpinWheelSync(spinWheelId.toString(), {
      status: "progress",
      synced,
      total,
    });
  }

  await SpinWheel.findByIdAndUpdate(spinWheelId, {
    "eventSource.lastSync": {
      at: new Date(),
      count: total,
    },
  });

  emitSpinWheelSync(spinWheelId.toString(), {
    status: "completed",
    synced: total,
    total,
  });
}

module.exports = {
  runSpinWheelSync,
};
