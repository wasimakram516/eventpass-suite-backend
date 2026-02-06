const SpinWheel = require("../../models/SpinWheel");
const SpinWheelParticipant = require("../../models/SpinWheelParticipant");
const Business = require("../../models/Business");
const response = require("../../utils/response");
const asyncHandler = require("../../middlewares/asyncHandler");
const { uploadToS3, deleteFromS3 } = require("../../utils/s3Storage");
const { generateUniqueSlug } = require("../../utils/slugGenerator");
const { recomputeAndEmit } = require("../../socket/dashboardSocket");

// Create SpinWheel
exports.createSpinWheel = asyncHandler(async (req, res) => {
  const { business, title, slug, type, logoUrl, backgroundUrl, eventSource } = req.body;

  if (!business || !title || !type) {
    return response(res, 400, "Missing required fields");
  }

  if (type === "synced") {
    if (!eventSource?.enabled || !eventSource?.eventId) {
      return response(res, 400, "eventSource is required for synced wheels");
    }
  }

  const existingBusiness = await Business.findById(business);
  if (!existingBusiness) {
    return response(res, 404, "Business not found");
  }

  const finalSlug = await generateUniqueSlug(SpinWheel, "slug", slug);

  const spinWheel = await SpinWheel.createWithAuditUser(
    {
      business,
      title,
      slug: finalSlug,
      type,
      logoUrl: logoUrl || null,
      backgroundUrl: backgroundUrl || null,
      eventSource: type === "synced" ? eventSource : undefined,
    },
    req.user
  );

  // Fire background recompute
  recomputeAndEmit(business || null).catch((err) =>
    console.error("Background recompute failed:", err.message)
  );

  return response(res, 201, "SpinWheel created successfully", spinWheel);
});

// Get All SpinWheels
exports.getAllSpinWheels = asyncHandler(async (req, res) => {
  const wheels = await SpinWheel.find()
    
    .populate("business", "name slug")
    .populate("createdBy", "name")
    .populate("updatedBy", "name")
    .sort({ createdAt: -1 })
    .lean();

  // Get participant counts for each wheel
  const wheelIds = wheels.map((w) => w._id);
  const participantCounts = await SpinWheelParticipant.aggregate([
    {
      $match: {
        spinWheel: { $in: wheelIds },
        isDeleted: { $ne: true },
      },
    },
    {
      $group: {
        _id: "$spinWheel",
        count: { $sum: 1 },
      },
    },
  ]);

  const countMap = {};
  participantCounts.forEach((pc) => {
    countMap[pc._id.toString()] = pc.count;
  });

  const wheelsWithCounts = wheels.map((wheel) => ({
    ...wheel,
    participantCount: countMap[wheel._id.toString()] || 0,
  }));

  return response(res, 200, "Fetched all spin wheels", wheelsWithCounts);
});

// Get SpinWheel by ID
exports.getSpinWheelById = asyncHandler(async (req, res) => {
  const wheel = await SpinWheel.findById(req.params.id)
    
    .populate("business", "name slug")
    .populate("createdBy", "name")
    .populate("updatedBy", "name");
  if (!wheel) return response(res, 404, "SpinWheel not found");
  return response(res, 200, "SpinWheel found", wheel);
});

// Get SpinWheel by Slug
exports.getSpinWheelBySlug = asyncHandler(async (req, res) => {
  const wheel = await SpinWheel.findOne({ slug: req.params.slug })
    
    .populate("business", "name slug")
    .populate("createdBy", "name")
    .populate("updatedBy", "name");
  if (!wheel) return response(res, 404, "SpinWheel not found");
  return response(res, 200, "SpinWheel found", wheel);
});

// Update SpinWheel
exports.updateSpinWheel = asyncHandler(async (req, res) => {
  const wheel = await SpinWheel.findById(req.params.id);
  if (!wheel) return response(res, 404, "SpinWheel not found");

  const { title, slug, type, logoUrl, backgroundUrl, eventSource } = req.body;

  if (slug && slug !== wheel.slug) {
    wheel.slug = await generateUniqueSlug(SpinWheel, "slug", slug);
  }

  wheel.title = title || wheel.title;
  wheel.type = type || wheel.type;

  if (eventSource !== undefined) {
    wheel.eventSource = eventSource;
  }

  if (type === "synced" && !wheel.eventSource?.enabled) {
    return response(res, 400, "Synced wheel must have eventSource enabled");
  }

  const business = await Business.findById(wheel.business);
  if (!business) return response(res, 404, "Business not found");

  if (logoUrl !== undefined) {
    if (wheel.logoUrl && wheel.logoUrl !== logoUrl) {
      try {
        await deleteFromS3(wheel.logoUrl);
      } catch (err) {
        console.error("Failed to delete old logo from S3:", err);
      }
    }
    wheel.logoUrl = logoUrl || null;
  }

  if (backgroundUrl !== undefined) {

    if (wheel.backgroundUrl && wheel.backgroundUrl !== backgroundUrl) {
      try {
        await deleteFromS3(wheel.backgroundUrl);
      } catch (err) {
        console.error("Failed to delete old background from S3:", err);
      }
    }
    wheel.backgroundUrl = backgroundUrl || null;
  }

  wheel.setAuditUser(req.user);
  await wheel.save();
  // Fire background recompute
  recomputeAndEmit(wheel.business || null).catch((err) =>
    console.error("Background recompute failed:", err.message)
  );
  return response(res, 200, "SpinWheel updated successfully", wheel);
});

// Soft delete SpinWheel
exports.deleteSpinWheel = asyncHandler(async (req, res) => {
  const wheel = await SpinWheel.findById(req.params.id);
  if (!wheel) return response(res, 404, "SpinWheel not found");

  await wheel.softDelete(req.user.id);
  // Fire background recompute
  recomputeAndEmit(wheel.business || null).catch((err) =>
    console.error("Background recompute failed:", err.message)
  );
  return response(res, 200, "SpinWheel moved to recycle bin");
});

// Restore SpinWheel
exports.restoreSpinWheel = asyncHandler(async (req, res) => {
  const wheel = await SpinWheel.findOneDeleted({ _id: req.params.id });
  if (!wheel) return response(res, 404, "SpinWheel not found in trash");

  await wheel.restore();
  // Fire background recompute
  recomputeAndEmit(wheel.business || null).catch((err) =>
    console.error("Background recompute failed:", err.message)
  );
  return response(res, 200, "SpinWheel restored", wheel);
});

// function to cascade permanent delete spin wheel and its participants
const cascadePermanentDeleteSpinWheel = async (spinWheelId) => {
  const participants = await SpinWheelParticipant.find({
    spinWheel: spinWheelId,
  });

  for (const participant of participants) {
    await participant.deleteOne();
  }

  await SpinWheel.findByIdAndDelete(spinWheelId);
};

// Permanently delete SpinWheel
exports.permanentDeleteSpinWheel = asyncHandler(async (req, res) => {
  const wheel = await SpinWheel.findOneDeleted({ _id: req.params.id });
  if (!wheel) return response(res, 404, "SpinWheel not found in trash");

  if (wheel.logoUrl) await deleteFromS3(wheel.logoUrl);
  if (wheel.backgroundUrl) await deleteFromS3(wheel.backgroundUrl);

  await cascadePermanentDeleteSpinWheel(wheel._id);
  // Fire background recompute
  recomputeAndEmit(wheel.business || null).catch((err) =>
    console.error("Background recompute failed:", err.message)
  );
  return response(res, 200, "SpinWheel permanently deleted");
});

exports.restoreAllSpinWheels = asyncHandler(async (req, res) => {
  const deletedWheels = await SpinWheel.findDeleted();

  for (const wheel of deletedWheels) {
    await wheel.restore();
  }
  // Fire background recompute
  recomputeAndEmit(null).catch((err) =>
    console.error("Background recompute failed:", err.message)
  );
  return response(res, 200, `${deletedWheels.length} spin wheels restored.`);
});

exports.permanentDeleteAllSpinWheels = asyncHandler(async (req, res) => {
  const deletedWheels = await SpinWheel.findDeleted();

  for (const wheel of deletedWheels) {
    if (wheel.logoUrl) await deleteFromS3(wheel.logoUrl);
    if (wheel.backgroundUrl) await deleteFromS3(wheel.backgroundUrl);
    await cascadePermanentDeleteSpinWheel(wheel._id);
  }

  // Fire background recompute
  recomputeAndEmit(null).catch((err) =>
    console.error("Background recompute failed:", err.message)
  );

  return response(
    res,
    200,
    `${deletedWheels.length} spin wheels permanently deleted.`
  );
});
