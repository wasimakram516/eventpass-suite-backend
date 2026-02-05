const mongoose = require("mongoose");

const winnerSchema = new mongoose.Schema({
    spinWheel: {
        type: mongoose.Schema.Types.ObjectId,
        ref: "SpinWheel",
        required: true,
    },
    participant: {
        type: mongoose.Schema.Types.ObjectId,
        ref: "SpinWheelParticipant",
        required: true,
    },
    name: { type: String, required: true },
    phone: { type: String },
    isoCode: { type: String },
    company: { type: String },
}, { timestamps: true });

winnerSchema.plugin(require("../db/plugins/auditUser"));

module.exports = mongoose.models.SpinWheelWinner || mongoose.model("SpinWheelWinner", winnerSchema);

