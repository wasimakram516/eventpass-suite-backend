const asyncHandler = require("../../middlewares/asyncHandler");
const Log = require("../../models/Log");
const Event = require("../../models/Event");
const Registration = require("../../models/Registration");
const Game = require("../../models/Game");
const Poll = require("../../models/Poll");
const SpinWheel = require("../../models/SpinWheel");
const WallConfig = require("../../models/WallConfig");
const SurveyForm = require("../../models/SurveyForm");
const SurveyRecipient = require("../../models/SurveyRecipient");
const EventQuestion = require("../../models/EventQuestion");
const User = require("../../models/User");
const Business = require("../../models/Business");
const response = require("../../utils/response");
const mongoose = require("mongoose");

function escapeCsvValue(value) {
    if (value === null || value === undefined) return "";
    const str = String(value).replace(/"/g, '""');
    return /[",\n]/.test(str) ? `"${str}"` : str;
}

/** Normalize 12h time so midnight shows as 12:00 am instead of 00:00 am */
function formatTime12h(date, options = {}) {
    const opts = {
        day: "2-digit",
        month: "short",
        year: "numeric",
        hour: "2-digit",
        minute: "2-digit",
        hour12: true,
        ...options,
    };
    let str = new Intl.DateTimeFormat("en-GB", opts).format(date);
    return str.replace(/\b0?0:00\s*am\b/i, "12:00 am");
}

async function resolveItemNames(logs) {
    if (!logs || logs.length === 0) return logs;

    const byType = {
        Event: [],
        Registration: [],
        Game: [],
        Poll: [],
        WheelSpin: [],
        SpinWheel: [],
        MosaicWall: [],
        Question: [],
        User: [],
        SurveyRecipient: [],
        AuthEventMaybeUser: [],
    };
    for (const log of logs) {
        if (log.itemType && log.itemId && mongoose.Types.ObjectId.isValid(log.itemId)) {
            const id = log.itemId._id || log.itemId;
            if (!byType[log.itemType]) byType[log.itemType] = [];
            byType[log.itemType].push(id);
            // Backward compatibility: older user logs were incorrectly stored as itemType "Event" under Auth module.
            if (log.itemType === "Event" && log.module === "Auth") {
                byType.AuthEventMaybeUser.push(id);
            }
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
    if (byType.User.length) {
        const docs = await User.find({ _id: { $in: uniq(byType.User) } })
            .withDeleted()
            .select("_id name email")
            .lean();
        docs.forEach((d) => {
            const label = d.name || d.email || d._id?.toString();
            nameMap[`User:${d._id.toString()}`] = label;
        });
    }
    if (byType.SurveyRecipient.length) {
        const docs = await SurveyRecipient.find({ _id: { $in: uniq(byType.SurveyRecipient) } })
            .select("_id fullName email")
            .lean();
        docs.forEach((d) => {
            const label = d.fullName || d.email || d._id?.toString();
            nameMap[`SurveyRecipient:${d._id.toString()}`] = label;
        });
    }
    if (byType.AuthEventMaybeUser.length) {
        const docs = await User.find({ _id: { $in: uniq(byType.AuthEventMaybeUser) } })
            .withDeleted()
            .select("_id name email")
            .lean();
        docs.forEach((d) => {
            const key = `Event:${d._id.toString()}`;
            if (nameMap[key] == null) {
                nameMap[key] = d.name || d.email || d._id?.toString();
            }
        });
    }

    return logs.map((log) => {
        const id = log.itemId?._id || log.itemId;
        const key = id && log.itemType ? `${log.itemType}:${id.toString()}` : null;
        const plain = log.toObject ? log.toObject() : { ...log };
        const resolvedName = (key && nameMap[key]) || plain.itemNameSnapshot || null;
        return { ...plain, itemName: resolvedName };
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
    const logTypeCounts = { login: 0, create: 0, update: 0, delete: 0, restore: 0 };
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

/**
 * Super Admin only — export logs as CSV (all or filtered by query).
 */
exports.exportLogs = asyncHandler(async (req, res) => {
    const {
        logType,
        itemType,
        module,
        businessId,
        userId,
        from,
        to,
        timezone,
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

    const [rawLogs, total, totalAll] = await Promise.all([
        Log.find(filter)
            .sort({ createdAt: -1 })
            .populate("userId", "name email")
            .populate("businessId", "name slug"),
        Log.countDocuments(filter),
        Log.countDocuments({}),
    ]);

    const logs = await resolveItemNames(rawLogs);

    // Build metadata rows (use names for business/user when filtering by them)
    const activeFilters = [];
    if (logType) activeFilters.push(`Log Type: ${logType}`);
    if (itemType) activeFilters.push(`Item Type: ${itemType}`);
    if (module) activeFilters.push(`Module: ${module}`);
    if (businessId && mongoose.Types.ObjectId.isValid(businessId)) {
        const biz = await Business.findById(businessId).select("name").lean();
        activeFilters.push(`Business: ${biz?.name || businessId}`);
    }
    if (userId && mongoose.Types.ObjectId.isValid(userId)) {
        const u = await User.findById(userId).select("name email").lean();
        activeFilters.push(`User: ${u?.name || u?.email || userId}`);
    }

    const dateFormatterOptions = {
        day: "2-digit",
        month: "short",
        year: "numeric",
        hour: "2-digit",
        minute: "2-digit",
        hour12: true,
        ...(timezone ? { timeZone: timezone } : {}),
    };

    if (from) {
        const fromStr = formatTime12h(new Date(from), dateFormatterOptions);
        activeFilters.push(`From: ${fromStr}`);
    }
    if (to) {
        const toStr = formatTime12h(new Date(to), dateFormatterOptions);
        activeFilters.push(`To: ${toStr}`);
    }

    const exportedAt = formatTime12h(new Date(), dateFormatterOptions);

    const lines = [];
    lines.push([escapeCsvValue("Total Logs"), escapeCsvValue(totalAll)].join(","));
    lines.push([escapeCsvValue("Exported Logs"), escapeCsvValue(logs.length)].join(","));
    lines.push([escapeCsvValue("Exported At"), escapeCsvValue(exportedAt)].join(","));
    lines.push([
        escapeCsvValue("Applied Filters"),
        escapeCsvValue(activeFilters.length ? activeFilters.join("; ") : "None"),
    ].join(","));
    lines.push(""); // blank line before header

    // Match UI column order in Activity Logs table:
    // User, Log Type, Item Type, Item Name, Business, Module, Time
    const header = [
        "User",
        "Log Type",
        "Item Type",
        "Item Name",
        "Business",
        "Module",
        "Time",
    ];

    lines.push(header.map(escapeCsvValue).join(","));

    logs.forEach((log) => {
        const userName = log.userId?.name || "";
        const businessName = log.businessId?.name || "";
        const dateObj = log.createdAt ? new Date(log.createdAt) : null;
        const timeFormatted = dateObj
            ? formatTime12h(dateObj, dateFormatterOptions)
            : "";
        const cols = [
            userName,
            log.logType || "",
            log.itemType || "",
            log.itemName || "",
            businessName,
            log.module || "",
            timeFormatted,
        ];
        lines.push(cols.map(escapeCsvValue).join(","));
    });

    const csv = lines.join("\n");

    res.setHeader("Content-Type", "text/csv");
    res.setHeader(
        "Content-Disposition",
        "attachment; filename=\"audit_logs.csv\""
    );
    return res.send(csv);
});

