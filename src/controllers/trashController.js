const asyncHandler = require("../middlewares/asyncHandler");
const response = require("../utils/response");
const moduleMapping = require("../utils/trashMappings");

exports.getModuleCounts = asyncHandler(async (req, res) => {
  const counts = {};

  await Promise.all(
    Object.entries(moduleMapping).map(async ([key, { model, controller, condition }]) => {
      let total = 0;

      try {
        // Case 1: special controllers with countDeleted implemented
        if (controller?.countDeleted) {
          total = await controller.countDeleted();
        }
        // Case 2: normal model with flat condition
        else if (model && model.countDocuments) {
          // Handle nested condition (e.g., eventId.eventType)
          if (condition && Object.keys(condition).some((c) => c.includes("."))) {
            // populate and filter in-memory
            const items = await model.findDeleted({ isDeleted: true }).populate("eventId").lean();
            const filtered = items.filter((item) => {
              return Object.entries(condition).every(([path, val]) => {
                const [field, sub] = path.split(".");
                return item[field] && item[field][sub] === val;
              });
            });
            total = filtered.length;
          } else {
            // direct query
            total = await model.countDocumentsDeleted({ isDeleted: true, ...(condition || {}) });
          }
        }
      } catch (err) {
        console.error(`Error counting module ${key}:`, err.message);
      }

      counts[key] = total;
    })
  );

  return response(res, 200, "Fetched module deletion counts", counts);
});

/**
 * GET trash items (all modules or one)
 */
exports.getTrash = asyncHandler(async (req, res) => {
  const { model: moduleKey, deletedBy, startDate, endDate, page = 1, limit = 20 } = req.query;
  const query = { isDeleted: true };

  if (deletedBy) query.deletedBy = deletedBy;
  if (startDate || endDate) {
    query.deletedAt = {};
    if (startDate) query.deletedAt.$gte = new Date(startDate);
    if (endDate) query.deletedAt.$lte = new Date(endDate);
  }

  const results = {};

  const fetchModule = async (key) => {
    const entry = moduleMapping[key];
    if (!entry) return;

    const { model: M, condition } = entry;
    if (!M) return; // embedded cases handled elsewhere

    let q = M.findDeleted(query)
      .skip((page - 1) * limit)
      .limit(limit)
      .sort({ deletedAt: -1 })
      .lean();

    let countQ = M.countDocumentsDeleted(query);

    // If condition refers to a populated field (like eventId.eventType)
    if (condition && Object.keys(condition).some((c) => c.includes("."))) {
      q = M.findDeleted(query).populate("eventId").lean();
      const items = await q;
      const filtered = items.filter((item) => {
        return Object.entries(condition).every(([path, val]) => {
          const [field, sub] = path.split(".");
          return item[field] && item[field][sub] === val;
        });
      });
      const paged = filtered.slice((page - 1) * limit, page * limit);
      results[key] = { items: paged, total: filtered.length };
      return;
    }

    // Normal condition (direct field)
    const [items, total] = await Promise.all([
      M.findDeleted({ ...query, ...(condition || {}) })
        .skip((page - 1) * limit)
        .limit(limit)
        .sort({ deletedAt: -1 })
        .lean(),
      M.countDocumentsDeleted({ ...query, ...(condition || {}) }),
    ]);

    results[key] = { items, total };
  };

  if (moduleKey && moduleMapping[moduleKey]) {
    await fetchModule(moduleKey);
  } else {
    await Promise.all(Object.keys(moduleMapping).map(fetchModule));
  }

  return response(res, 200, "Fetched trash items", { items: results });
});

/**
 * Restore single item
 */
exports.restoreItem = asyncHandler(async (req, res, next) => {
  const { module } = req.params;
  const entry = moduleMapping[module];
  if (!entry) return response(res, 400, "Invalid module");
  if (!entry.controller.restore) return response(res, 400, "Restore not implemented for this module");
  return entry.controller.restore(req, res, next);
});

/**
 * Permanently delete single item
 */
exports.permanentDeleteItem = asyncHandler(async (req, res, next) => {
  const { module } = req.params;
  const entry = moduleMapping[module];
  if (!entry) return response(res, 400, "Invalid module");
  if (!entry.controller.permanentDelete) return response(res, 400, "Permanent delete not implemented for this module");
  return entry.controller.permanentDelete(req, res, next);
});

/**
 * Restore all items in a module
 */
exports.restoreAllItems = asyncHandler(async (req, res, next) => {
  const { module } = req.params;
  const entry = moduleMapping[module];
  if (!entry) return response(res, 400, "Invalid module");
  if (!entry.controller.restoreAll) return response(res, 400, "Bulk restore not implemented for this module");
  return entry.controller.restoreAll(req, res, next);
});

/**
 * Permanently delete all items in a module
 */
exports.permanentDeleteAllItems = asyncHandler(async (req, res, next) => {
  const { module } = req.params;
  const entry = moduleMapping[module];
  if (!entry) return response(res, 400, "Invalid module");
  if (!entry.controller.permanentDeleteAll) return response(res, 400, "Bulk permanent delete not implemented for this module");
  return entry.controller.permanentDeleteAll(req, res, next);
});
