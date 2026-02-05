const mongoose = require("mongoose");

const teamSchema = new mongoose.Schema(
  {
    name: {
      type: String,
      required: true,
      trim: true,
    },
    gameId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Game",
      required: true,
    },
  },
  { timestamps: true }
);

teamSchema.index({ gameId: 1, name: 1 }, { unique: true });
teamSchema.plugin(require("../db/plugins/softDelete"));
teamSchema.plugin(require("../db/plugins/auditUser"));

module.exports = mongoose.models.Team || mongoose.model("Team", teamSchema);
