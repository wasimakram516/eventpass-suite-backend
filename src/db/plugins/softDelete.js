const { Schema, Types } = require("mongoose");

module.exports = function softDelete(schema) {
  schema.add({
    isDeleted: { type: Boolean, default: false, index: true },
    deletedAt: { type: Date },
    deletedBy: { type: Schema.Types.ObjectId, ref: "User" },
  });

  // Query helper: exclude trashed by default
  schema.query.notDeleted = function () {
    return this.where({
      $or: [{ isDeleted: false }, { isDeleted: { $exists: false } }],
    });
  };

  // Instance methods
  schema.methods.softDelete = function (userId) {
    this.isDeleted = true;
    this.deletedAt = new Date();
    this.deletedBy = userId ? new Types.ObjectId(userId) : undefined;
    return this.save();
  };

  schema.methods.restore = function () {
    this.isDeleted = false;
    this.deletedAt = undefined;
    this.deletedBy = undefined;
    return this.save();
  };

  // 🔹 New static helpers
  schema.statics.findDeleted = function (conditions = {}, projection = null, options = {}) {
    return this.find({ ...conditions, isDeleted: true }, projection, options);
  };

  schema.statics.findOneDeleted = function (conditions = {}, projection = null, options = {}) {
    return this.findOne({ ...conditions, isDeleted: true }, projection, options);
  };

  schema.statics.countDocumentsDeleted = function (conditions = {}) {
    return this.countDocuments({ ...conditions, isDeleted: true });
  };

  // For fields with unique constraints (slug, email, token, etc.)
  schema.addPartialUnique = function (fields) {
    schema.index(fields, {
      unique: true,
      partialFilterExpression: { isDeleted: false },
    });
  };
};
