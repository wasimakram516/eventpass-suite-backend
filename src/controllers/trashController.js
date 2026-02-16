const asyncHandler = require("../middlewares/asyncHandler");
const response = require("../utils/response");
const moduleMapping = require("../utils/trashMappings");
const mongoose = require("mongoose");
const { createLog } = require("../utils/logger");

const MODEL_TO_ITEM_TYPE = {
  User: "User",
  Business: "Event",
  Event: "Event",
  Registration: "Registration",
  Poll: "Poll",
  SpinWheel: "SpinWheel",
  SpinWheelParticipant: "WheelSpin",
  DisplayMedia: "MosaicWall",
  WallConfig: "MosaicWall",
  GlobalConfig: null,
  Game: "Game",
  GameSession: "Game",
  SurveyForm: "Event",
  WalkIn: "Registration",
  EventQuestion: "Question",
};

function mapModuleName(moduleKey = "") {
  const key = String(moduleKey).toLowerCase();
  if (key.includes("eventreg")) return "EventReg";
  if (key.includes("checkin")) return "CheckIn";
  if (key.includes("digipass")) return "DigiPass";
  if (key.includes("votecast") || key === "poll") return "VoteCast";
  if (key.includes("eventduel") || key.includes("pvp")) return "EventDuel";
  if (key.includes("tapmatch")) return "TapMatch";
  if (key.includes("quiznest") || key.includes("qn")) return "QuizNest";
  if (key.includes("survey")) return "SurveyGuru";
  if (key.includes("stageq") || key === "question") return "StageQ";
  if (key.includes("spinwheel") || key.includes("wheel")) return "EventWheel";
  if (key.includes("wall") || key.includes("media") || key.includes("mosaic"))
    return "MosaicWall";
  if (key === "user" || key.includes("business")) return "User";
  return "Other";
}

function getLogMetaForModule(moduleKey, entry) {
  const modelName = entry?.model?.modelName || null;
  return {
    itemType: MODEL_TO_ITEM_TYPE[modelName] ?? null,
    module: mapModuleName(moduleKey),
  };
}

/**
 * Utility: build query / aggregation depending on condition type
 */
async function fetchDeletedItems({
  model,
  query,
  condition,
  page,
  limit,
  customAggregation,
}) {
  if (customAggregation && model.modelName === "Game") {
    return await fetchDeletedQuestions({
      model,
      query,
      condition,
      page,
      limit,
    });
  }

  // Case: condition on nested field (e.g. event.eventType or gameId.mode)
  if (condition && Object.keys(condition).some((c) => c.includes("."))) {
    let pipeline;

    if (Object.keys(condition).some((key) => key.startsWith("gameId."))) {
      pipeline = [
        { $match: { isDeleted: true, ...query } },
        {
          $lookup: {
            from: "games",
            localField: "gameId",
            foreignField: "_id",
            as: "game",
          },
        },
        { $unwind: "$game" },
        {
          $lookup: {
            from: "users",
            localField: "deletedBy",
            foreignField: "_id",
            as: "deletedByUser",
          },
        },
        {
          $unwind: {
            path: "$deletedByUser",
            preserveNullAndEmptyArrays: true,
          },
        },
        {
          $addFields: {
            deletedBy: {
              $cond: {
                if: { $ifNull: ["$deletedByUser", false] },
                then: {
                  _id: "$deletedByUser._id",
                  name: "$deletedByUser.name",
                  fullName: "$deletedByUser.fullName",
                  email: "$deletedByUser.email",
                },
                else: "$deletedBy",
              },
            },
          },
        },
        {
          $project: {
            deletedByUser: 0,
          },
        },
        { $match: { "game.mode": condition["gameId.mode"] } },
        { $sort: { deletedAt: -1 } },
      ];
    } else {
      pipeline = [
        { $match: { isDeleted: true, ...query } },
        {
          $lookup: {
            from: "events",
            localField: "eventId",
            foreignField: "_id",
            as: "event",
          },
        },
        {
          $unwind: {
            path: "$event",
            preserveNullAndEmptyArrays: true, // include registrations even if parent event is deleted
          },
        },
        {
          $lookup: {
            from: "users",
            localField: "deletedBy",
            foreignField: "_id",
            as: "deletedByUser",
          },
        },
        {
          $unwind: {
            path: "$deletedByUser",
            preserveNullAndEmptyArrays: true,
          },
        },
        {
          $addFields: {
            deletedBy: {
              $cond: {
                if: { $ifNull: ["$deletedByUser", false] },
                then: {
                  _id: "$deletedByUser._id",
                  name: "$deletedByUser.name",
                  fullName: "$deletedByUser.fullName",
                  email: "$deletedByUser.email",
                },
                else: "$deletedBy",
              },
            },
          },
        },
        {
          $project: {
            deletedByUser: 0,
          },
        },
        {
          $match: condition || {}, // e.g. { "event.eventType": "public" }
        },
        { $sort: { deletedAt: -1 } },
      ];
    }

    const [items, totalResult] = await Promise.all([
      model.aggregate([
        ...pipeline,
        { $skip: (page - 1) * limit },
        { $limit: limit },
      ]).option({ withDeleted: true }),
      model.aggregate([...pipeline, { $count: "total" }]).option({ withDeleted: true }),
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
 *function to fetch deleted questions from embedded arrays
 */
async function fetchDeletedQuestions({ model, query, condition, page, limit }) {
  const pipeline = [
    {
      $match: {
        ...query,
        ...(condition || {}),
        "questions.isDeleted": true,
      },
    },
    { $unwind: "$questions" },
    { $match: { "questions.isDeleted": true } },
    {
      $project: {
        _id: "$questions._id",
        question: "$questions.question",
        answers: "$questions.answers",
        correctAnswerIndex: "$questions.correctAnswerIndex",
        hint: "$questions.hint",
        isDeleted: "$questions.isDeleted",
        deletedAt: "$questions.deletedAt",
        deletedBy: "$questions.deletedBy",
        gameId: "$_id",
        gameTitle: "$title",
        gameSlug: "$slug",
        createdAt: "$questions.createdAt",
        updatedAt: "$questions.updatedAt",
      },
    },
    { $sort: { deletedAt: -1 } },
  ];

  const [items, totalResult] = await Promise.all([
    model.aggregate([
      ...pipeline,
      { $skip: (page - 1) * limit },
      { $limit: limit },
    ]).option({ withDeleted: true }),
    model.aggregate([...pipeline, { $count: "total" }]).option({ withDeleted: true }),
  ]);

  const total = totalResult[0]?.total || 0;
  return { items, total };
}

/**
 * Count trashed items for each module
 */
exports.getModuleCounts = asyncHandler(async (req, res) => {
  const counts = {};

  await Promise.all(
    Object.entries(moduleMapping).map(
      async ([key, { model, controller, condition, customAggregation }]) => {
        try {
          if (controller?.countDeleted) {
            // Use custom counter if defined in controller
            counts[key] = await controller.countDeleted();
          } else if (model?.countDocumentsDeleted) {
            if (customAggregation && model.modelName === "Game") {
              const result = await fetchDeletedQuestions({
                model,
                query: {},
                condition,
                page: 1,
                limit: Number.MAX_SAFE_INTEGER,
              });
              counts[key] = result.total;
            } else if (
              condition &&
              Object.keys(condition).some((c) => c.includes("."))
            ) {
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
      }
    )
  );

  return response(res, 200, "Fetched module deletion counts", counts);
});

/**
 * GET trash items (all modules or one)
 */
exports.getTrash = asyncHandler(async (req, res) => {
  const {
    model: moduleKey,
    deletedBy,
    startDate,
    endDate,
    page = 1,
    limit = 20,
  } = req.query;

  const query = {};
  if (deletedBy) query.deletedBy = new mongoose.Types.ObjectId(deletedBy);
  if (startDate || endDate) {
    query.deletedAt = {};
    if (startDate) query.deletedAt.$gte = new Date(startDate);
    if (endDate) query.deletedAt.$lte = new Date(endDate);
  }

  const results = {};

  if (moduleKey && moduleMapping[moduleKey]) {
    // Single module
    const { model, condition, customAggregation } = moduleMapping[moduleKey];
    results[moduleKey] = await fetchDeletedItems({
      model,
      query,
      condition,
      page: Number(page),
      limit: Number(limit),
      customAggregation,
    });
  } else if (!moduleKey) {
    // All modules (only when explicitly requested with no model param)
    await Promise.all(
      Object.entries(moduleMapping).map(
        async ([key, { model, condition, customAggregation }]) => {
          try {
            results[key] = await fetchDeletedItems({
              model,
              query,
              condition,
              page: Number(page),
              limit: Number(limit),
              customAggregation,
            });
          } catch (err) {
            console.error(`Error fetching trash for ${key}:`, err.message);
            results[key] = { items: [], total: 0 };
          }
        }
      )
    );
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
  if (!entry.controller.restore)
    return response(res, 400, "Restore not implemented for this module");

  const { itemType, module: moduleName } = getLogMetaForModule(module, entry);
  const originalJson = res.json.bind(res);
  res.json = function (body) {
    if (res.statusCode >= 200 && res.statusCode < 300) {
      createLog({
        userId: req.user?._id ?? req.user?.id ?? null,
        logType: "restore",
        itemType,
        itemId: req.params?.id ?? null,
        businessId:
          body?.data?.businessId ??
          body?.data?.business?._id ??
          req.body?.businessId ??
          req.query?.businessId ??
          null,
        module: moduleName,
        meta: { action: "restore", source: "trash" },
      });
    }
    return originalJson(body);
  };

  return entry.controller.restore(req, res, next);
});

exports.permanentDeleteItem = asyncHandler(async (req, res, next) => {
  const { module } = req.params;
  const entry = moduleMapping[module];
  if (!entry) return response(res, 400, "Invalid module");
  if (!entry.controller.permanentDelete)
    return response(
      res,
      400,
      "Permanent delete not implemented for this module"
    );
  return entry.controller.permanentDelete(req, res, next);
});

exports.restoreAllItems = asyncHandler(async (req, res, next) => {
  const { module } = req.params;
  const entry = moduleMapping[module];
  if (!entry) return response(res, 400, "Invalid module");
  if (!entry.controller.restoreAll)
    return response(res, 400, "Bulk restore not implemented for this module");

  const { itemType, module: moduleName } = getLogMetaForModule(module, entry);
  const originalJson = res.json.bind(res);
  res.json = function (body) {
    if (res.statusCode >= 200 && res.statusCode < 300) {
      createLog({
        userId: req.user?._id ?? req.user?.id ?? null,
        logType: "restore",
        itemType,
        itemId: null,
        businessId:
          req.body?.businessId ??
          req.query?.businessId ??
          null,
        module: moduleName,
        meta: { action: "restore_all", source: "trash", targetModule: module },
      });
    }
    return originalJson(body);
  };

  return entry.controller.restoreAll(req, res, next);
});

exports.permanentDeleteAllItems = asyncHandler(async (req, res, next) => {
  const { module } = req.params;
  const entry = moduleMapping[module];
  if (!entry) return response(res, 400, "Invalid module");
  if (!entry.controller.permanentDeleteAll)
    return response(
      res,
      400,
      "Bulk permanent delete not implemented for this module"
    );
  return entry.controller.permanentDeleteAll(req, res, next);
});
