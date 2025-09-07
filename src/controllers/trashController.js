const asyncHandler = require("../middlewares/asyncHandler");
const response = require("../utils/response");
const moduleMapping = require("../utils/trashMappings");
const mongoose = require("mongoose");

/**
 * Utility: build query / aggregation depending on condition type
 */
async function fetchDeletedItems({ model, query, condition, page, limit }) {
  // Case: condition on nested field (e.g. eventId.eventType)
  if (condition && Object.keys(condition).some((c) => c.includes("."))) {
    const pipeline = [
      { $match: { isDeleted: true, ...query } },
      {
        $lookup: {
          from: "events", 
          localField: "eventId",
          foreignField: "_id",
          as: "event",
        },
      },
      { $unwind: "$event" },
      { $match: condition }, // e.g. { "event.eventType": "public" }
      { $sort: { deletedAt: -1 } },
    ];

    const [items, totalResult] = await Promise.all([
      model.aggregate([
        ...pipeline,
        { $skip: (page - 1) * limit },
        { $limit: limit },
      ]),
      model.aggregate([
        ...pipeline,
        { $count: "total" },
      ]),
    ]);

    const total = totalResult[0]?.total || 0;
    return { items, total };
  }

  // Case: flat condition or none
  const [items, total] = await Promise.all([
    model
      .findDeleted({ ...query, ...(condition || {}) })
      .skip((page - 1) * limit)
      .limit(limit)
      .sort({ deletedAt: -1 })
      .lean(),
    model.countDocumentsDeleted({ ...query, ...(condition || {}) }),
  ]);

  return { items, total };
}

/**
 * Count trashed items for each module
 */
exports.getModuleCounts = asyncHandler(async (req, res) => {
  const counts = {};

  await Promise.all(
    Object.entries(moduleMapping).map(async ([key, { model, controller, condition }]) => {
      try {
        if (controller?.countDeleted) {
          // Use custom counter if defined in controller
          counts[key] = await controller.countDeleted();
        } else if (model?.countDocumentsDeleted) {
          // Use plugin’s countDocumentsDeleted
          if (condition && Object.keys(condition).some((c) => c.includes("."))) {
            // Nested conditions via aggregation
            const result = await fetchDeletedItems({
              model,
              query: {},
              condition,
              page: 1,
              limit: Number.MAX_SAFE_INTEGER, 
            });
            counts[key] = result.total;
          } else {
            counts[key] = await model.countDocumentsDeleted({ ...condition });
          }
        } else {
          counts[key] = 0;
        }
      } catch (err) {
        console.error(`Error counting module ${key}:`, err.message);
        counts[key] = 0;
      }
    })
  );

  return response(res, 200, "Fetched module deletion counts", counts);
});

/**
 * GET trash items (all modules or one)
 */
exports.getTrash = asyncHandler(async (req, res) => {
  const { model: moduleKey, deletedBy, startDate, endDate, page = 1, limit = 20 } = req.query;

  const query = {};
  if (deletedBy) query.deletedBy = new mongoose.Types.ObjectId(deletedBy);
  if (startDate || endDate) {
    query.deletedAt = {};
    if (startDate) query.deletedAt.$gte = new Date(startDate);
    if (endDate) query.deletedAt.$lte = new Date(endDate);
  }

  const results = {};

  const fetchModule = async (key) => {
    const entry = moduleMapping[key];
    if (!entry?.model) return;

    const { model, condition } = entry;
    results[key] = await fetchDeletedItems({
      model,
      query,
      condition,
      page: Number(page),
      limit: Number(limit),
    });
  };

  if (moduleKey && moduleMapping[moduleKey]) {
    await fetchModule(moduleKey);
  } else {
    await Promise.all(Object.keys(moduleMapping).map(fetchModule));
  }

  return response(res, 200, "Fetched trash items", { items: results });
});

/**
 * Restore / Permanently delete (single + all) via controllers
 */
exports.restoreItem = asyncHandler(async (req, res, next) => {
  const { module } = req.params;
  const entry = moduleMapping[module];
  if (!entry) return response(res, 400, "Invalid module");
  if (!entry.controller.restore) return response(res, 400, "Restore not implemented for this module");
  return entry.controller.restore(req, res, next);
});

exports.permanentDeleteItem = asyncHandler(async (req, res, next) => {
  const { module } = req.params;
  const entry = moduleMapping[module];
  if (!entry) return response(res, 400, "Invalid module");
  if (!entry.controller.permanentDelete) return response(res, 400, "Permanent delete not implemented for this module");
  return entry.controller.permanentDelete(req, res, next);
});

exports.restoreAllItems = asyncHandler(async (req, res, next) => {
  const { module } = req.params;
  const entry = moduleMapping[module];
  if (!entry) return response(res, 400, "Invalid module");
  if (!entry.controller.restoreAll) return response(res, 400, "Bulk restore not implemented for this module");
  return entry.controller.restoreAll(req, res, next);
});

exports.permanentDeleteAllItems = asyncHandler(async (req, res, next) => {
  const { module } = req.params;
  const entry = moduleMapping[module];
  if (!entry) return response(res, 400, "Invalid module");
  if (!entry.controller.permanentDeleteAll) return response(res, 400, "Bulk permanent delete not implemented for this module");
  return entry.controller.permanentDeleteAll(req, res, next);
});
