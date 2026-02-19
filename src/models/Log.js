const mongoose = require("mongoose");

const LogSchema = new mongoose.Schema(
    {
        userId: {
            type: mongoose.Schema.Types.ObjectId,
            ref: "User",
            default: null,
        },
        logType: {
            type: String,
            enum: ["login", "create", "update", "delete", "restore"],
            required: true,
        },
        itemType: {
            type: String,
            enum: [null, "Event", "Registration", "WheelSpin", "SpinWheel", "MosaicWall", "Poll", "Game", "Question", "User", "SurveyRecipient"],
            default: null,
        },
        itemId: {
            type: mongoose.Schema.Types.ObjectId,
            default: null,
        },
        businessId: {
            type: mongoose.Schema.Types.ObjectId,
            ref: "Business",
            default: null,
        },
        module: {
            type: String,
            enum: [null, "EventReg", "QuizNest", "EventDuel", "TapMatch", "VoteCast", "SurveyGuru", "CheckIn", "DigiPass", "StageQ", "MosaicWall", "EventWheel", "Auth", "User", "Other"],
            default: null,
        },
        itemNameSnapshot: { type: String, default: null },
    },
    { timestamps: true }
);

LogSchema.index({ userId: 1 });
LogSchema.index({ businessId: 1 });
LogSchema.index({ logType: 1 });
LogSchema.index({ module: 1 });
LogSchema.index({ createdAt: -1 });

module.exports = mongoose.models.Log || mongoose.model("Log", LogSchema);
