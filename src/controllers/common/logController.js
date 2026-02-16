const asyncHandler = require("../../middlewares/asyncHandler");
const Log = require("../../models/Log");
const Event = require("../../models/Event");
const Registration = require("../../models/Registration");
const Game = require("../../models/Game");
const Poll = require("../../models/Poll");
const SpinWheel = require("../../models/SpinWheel");
const WallConfig = require("../../models/WallConfig");
const SurveyForm = require("../../models/SurveyForm");
const EventQuestion = require("../../models/EventQuestion");
const response = require("../../utils/response");
const mongoose = require("mongoose");

async function resolveItemNames(logs) {
    if (!logs || logs.length === 0) return logs;

    const byType = { Event: [], Registration: [], Game: [], Poll: [], WheelSpin: [], SpinWheel: [], MosaicWall: [], Question: [] };
    for (const log of logs) {
        if (log.itemType && log.itemId && mongoose.Types.ObjectId.isValid(log.itemId)) {
            const id = log.itemId._id || log.itemId;
            if (!byType[log.itemType]) byType[log.itemType] = [];
            byType[log.itemType].push(id);
        }
    }

    const nameMap = {};
    const uniq = (arr) => [...new Set(arr.map((id) => id.toString()))];

    if (byType.Event.length) {
        const eventIds = uniq(byType.Event);
        const events = await Event.find({ _id: { $in: eventIds } }).withDeleted().select("_id name").lean();
        events.forEach((d) => { nameMap[`Event:${d._id.toString()}`] = d.name || null; });
        // SurveyGuru logs use itemType "Event" but itemId is SurveyForm._id — resolve form title
        const forms = await SurveyForm.find({ _id: { $in: eventIds } }).withDeleted().select("_id title").lean();
        forms.forEach((d) => {
            if (nameMap[`Event:${d._id.toString()}`] == null)
                nameMap[`Event:${d._id.toString()}`] = d.title || null;
        });
    }
    if (byType.Registration.length) {
        const docs = await Registration.find({ _id: { $in: uniq(byType.Registration) } })
            .withDeleted()
            .select("_id fullName email token")
            .lean();
        docs.forEach((d) => {
            const label = d.fullName || d.email || d.token || d._id?.toString();
            nameMap[`Registration:${d._id.toString()}`] = label;
        });
    }
    if (byType.Game.length) {
        const docs = await Game.find({ _id: { $in: uniq(byType.Game) } }).withDeleted().select("_id title").lean();
        docs.forEach((d) => { nameMap[`Game:${d._id.toString()}`] = d.title || null; });
    }
    if (byType.Poll.length) {
        const docs = await Poll.find({ _id: { $in: uniq(byType.Poll) } }).withDeleted().select("_id question").lean();
        docs.forEach((d) => { nameMap[`Poll:${d._id.toString()}`] = d.question || null; });
    }
    const spinWheelIds = uniq([...byType.WheelSpin, ...byType.SpinWheel]);
    if (spinWheelIds.length) {
        const docs = await SpinWheel.find({ _id: { $in: spinWheelIds } }).withDeleted().select("_id title").lean();
        docs.forEach((d) => {
            const idStr = d._id.toString();
            nameMap[`WheelSpin:${idStr}`] = d.title || null;
            nameMap[`SpinWheel:${idStr}`] = d.title || null;
        });
    }
    if (byType.MosaicWall.length) {
        const docs = await WallConfig.find({ _id: { $in: uniq(byType.MosaicWall) } }).withDeleted().select("_id name").lean();
        docs.forEach((d) => { nameMap[`MosaicWall:${d._id.toString()}`] = d.name || null; });
    }
    if (byType.Question.length) {
        const questionIds = uniq(byType.Question);
        const games = await Game.find({ "questions._id": { $in: questionIds } }).withDeleted().select("questions").lean();
        const questionIdSet = new Set(questionIds.map((id) => id.toString()));
        games.forEach((g) => {
            (g.questions || []).forEach((q) => {
                if (q && q._id && questionIdSet.has(q._id.toString())) {
                    const text = (q.question && String(q.question).trim()) || null;
                    nameMap[`Question:${q._id.toString()}`] = text;
                }
            });
        });
        const stageQQuestions = await EventQuestion.find({ _id: { $in: questionIds } }).withDeleted().select("_id text").lean();
        stageQQuestions.forEach((d) => {
            if (nameMap[`Question:${d._id.toString()}`] == null)
                nameMap[`Question:${d._id.toString()}`] = (d.text && String(d.text).trim()) || null;
        });
    }

    return logs.map((log) => {
        const id = log.itemId?._id || log.itemId;
        const key = id && log.itemType ? `${log.itemType}:${id.toString()}` : null;
        const plain = log.toObject ? log.toObject() : { ...log };
        return { ...plain, itemName: (key && nameMap[key]) || null };
    });
}

/**
 * GET /api/logs
 * Super Admin only — paginated, filterable log list.
 *
 * Query params:
 *  page, limit, logType, itemType, module, businessId, userId, from, to
 */
exports.getLogs = asyncHandler(async (req, res) => {
    const {
        page = 1,
        limit = 50,
        logType,
        itemType,
        module,
        businessId,
        userId,
        from,
        to,
    } = req.query;

    const filter = {};

    if (logType) filter.logType = logType;
    if (itemType) filter.itemType = itemType;
    if (module) filter.module = module;

    if (businessId && mongoose.Types.ObjectId.isValid(businessId)) {
        filter.businessId = new mongoose.Types.ObjectId(businessId);
    }

    if (userId && mongoose.Types.ObjectId.isValid(userId)) {
        filter.userId = new mongoose.Types.ObjectId(userId);
    }

    if (from || to) {
        filter.createdAt = {};
        if (from) filter.createdAt.$gte = new Date(from);
        if (to) filter.createdAt.$lte = new Date(to);
    }

    const pageNum = Math.max(1, Number(page));
    const limitNum = Math.min(200, Math.max(1, Number(limit))); // cap at 200
    const skip = (pageNum - 1) * limitNum;

    const [rawLogs, total] = await Promise.all([
        Log.find(filter)
            .sort({ createdAt: -1 })
            .skip(skip)
            .limit(limitNum)
            .populate("userId", "name email")
            .populate("businessId", "name slug"),
        Log.countDocuments(filter),
    ]);

    const logs = await resolveItemNames(rawLogs);

    return response(res, 200, "Logs fetched successfully", {
        logs,
        total,
        page: pageNum,
        limit: limitNum,
        totalPages: Math.ceil(total / limitNum),
    });
});

/**
 * GET /api/logs/stats
 * Super Admin only — aggregate counts for dashboard summary widgets.
 *
 * Query params: businessId, module, from, to
 */
exports.getLogStats = asyncHandler(async (req, res) => {
    const { businessId, module, from, to } = req.query;

    const matchStage = {};

    if (businessId && mongoose.Types.ObjectId.isValid(businessId)) {
        matchStage.businessId = new mongoose.Types.ObjectId(businessId);
    }
    if (module) {
        matchStage.module = module;
    }
    if (from || to) {
        matchStage.createdAt = {};
        if (from) matchStage.createdAt.$gte = new Date(from);
        if (to) matchStage.createdAt.$lte = new Date(to);
    }

    // ── Counts by logType ─────────────────────────────────────────────────────
    const byLogType = await Log.aggregate([
        { $match: matchStage },
        { $group: { _id: "$logType", count: { $sum: 1 } } },
    ]);

    // ── Counts by module ──────────────────────────────────────────────────────
    const byModule = await Log.aggregate([
        { $match: matchStage },
        { $group: { _id: "$module", count: { $sum: 1 } } },
    ]);

    // ── Counts by itemType ────────────────────────────────────────────────────
    const byItemType = await Log.aggregate([
        { $match: matchStage },
        { $group: { _id: "$itemType", count: { $sum: 1 } } },
    ]);

    // Build clean objects with 0-defaults
    const logTypeCounts = { login: 0, create: 0, update: 0, delete: 0 };
    byLogType.forEach((s) => { if (s._id) logTypeCounts[s._id] = s.count; });

    const moduleCounts = {};
    byModule.forEach((s) => { if (s._id) moduleCounts[s._id] = s.count; });

    const itemTypeCounts = {};
    byItemType.forEach((s) => { if (s._id) itemTypeCounts[s._id] = s.count; });

    return response(res, 200, "Log stats fetched successfully", {
        byLogType: logTypeCounts,
        byModule: moduleCounts,
        byItemType: itemTypeCounts,
        total: Object.values(logTypeCounts).reduce((a, b) => a + b, 0),
    });
});