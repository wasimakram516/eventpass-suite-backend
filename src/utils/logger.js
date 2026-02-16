const Log = require("../models/Log");
const Event = require("../models/Event");
const Registration = require("../models/Registration");
const Game = require("../models/Game");
const Poll = require("../models/Poll");
const SpinWheel = require("../models/SpinWheel");
const WallConfig = require("../models/WallConfig");
const SurveyForm = require("../models/SurveyForm");
const mongoose = require("mongoose");
const { emitUpdate } = require("./socketUtils");

async function getItemName(itemType, itemId) {
    if (!itemType || !itemId || !mongoose.Types.ObjectId.isValid(itemId)) return null;
    const id = new mongoose.Types.ObjectId(itemId);
    try {
        if (itemType === "Event") {
            const d = await Event.findOne({ _id: id }).withDeleted().select("name").lean();
            if (d?.name) return d.name;
            const form = await SurveyForm.findOne({ _id: id }).withDeleted().select("title").lean();
            return form?.title || null;
        }
        if (itemType === "Registration") {
            const d = await Registration.findOne({ _id: id }).withDeleted().select("fullName email token").lean();
            return (d && (d.fullName || d.email || d.token)) || null;
        }
        if (itemType === "Game") {
            const d = await Game.findOne({ _id: id }).withDeleted().select("title").lean();
            return d?.title || null;
        }
        if (itemType === "Poll") {
            const d = await Poll.findOne({ _id: id }).withDeleted().select("question").lean();
            return d?.question || null;
        }
        if (itemType === "WheelSpin" || itemType === "SpinWheel") {
            const d = await SpinWheel.findOne({ _id: id }).withDeleted().select("title").lean();
            return d?.title || null;
        }
        if (itemType === "MosaicWall") {
            const d = await WallConfig.findOne({ _id: id }).withDeleted().select("name").lean();
            return d?.name || null;
        }
        if (itemType === "Question") {
            const game = await Game.findOne({ "questions._id": id }).withDeleted().select("questions").lean();
            if (game?.questions) {
                const q = game.questions.find((x) => x && x._id && x._id.toString() === id.toString());
                if (q?.question) return String(q.question).trim();
            }
            const EventQuestion = require("../models/EventQuestion");
            const stageQ = await EventQuestion.findOne({ _id: id }).withDeleted().select("text").lean();
            return (stageQ?.text && String(stageQ.text).trim()) || null;
        }
    } catch (err) {
        return null;
    }
    return null;
}

/**
 * createLog — fire-and-forget. Never throws, never blocks a request.
 * Emits "logCreated" on socket so clients can show new logs in real time.
 *
 * Every log record stores:
 *  - userId      (who did it)
 *  - logType     (login | create | update | delete)
 *  - itemType    (Event | Registration | WheelSpin | MosaicWall | Poll | Game)
 *  - itemId      (MongoDB _id of the affected document)
 *  - businessId  (which business this action belongs to)
 *  - module      (EventReg | QuizNest | DigiPass | VoteCast | Auth | Other)
 *  - meta        (any extra context — name, slug, ip, etc.)
 *  - createdAt   (auto via timestamps)
 *  - updatedAt   (auto via timestamps)
 */
const createLog = ({
    userId = null,
    logType,
    itemType = null,
    itemId = null,
    businessId = null,
    module = "Other",
    meta = {},
}) => {
    const safeId = (val) => {
        if (!val) return null;
        if (mongoose.Types.ObjectId.isValid(val)) return new mongoose.Types.ObjectId(val);
        return null;
    };

    Log.create({
        userId: safeId(userId),
        logType,
        itemType,
        itemId: safeId(itemId),
        businessId: safeId(businessId),
        module,
        meta,
    })
        .then((doc) =>
            Log.findById(doc._id)
                .populate("userId", "name email")
                .populate("businessId", "name slug")
                .lean()
                .exec()
        )
        .then(async (populated) => {
            if (populated) {
                const itemName = await getItemName(populated.itemType, populated.itemId);
                emitUpdate("logCreated", { ...populated, itemName: itemName || null });
            }
        })
        .catch((err) =>
            console.error("[Logger] Failed to write log entry:", err.message)
        );
};

module.exports = { createLog };