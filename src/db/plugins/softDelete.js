const { Schema, Types } = require("mongoose");

module.exports = function softDelete(schema) {
  schema.add({
    isDeleted: { type: Boolean, default: false, index: true },
    deletedAt: { type: Date },
    deletedBy: { type: Schema.Types.ObjectId, ref: "User" },
  });

  // Query helper
  schema.query.notDeleted = function () {
    return this.where({
      $or: [{ isDeleted: false }, { isDeleted: { $exists: false } }],
    });
  };

  // Opt-out helper for trash/restore queries
  schema.query.withDeleted = function () {
    this._withDeleted = true;
    return this;
  };

  // Default scope: exclude deleted records on reads
  function applyNotDeleted(next) {
    if (!this._withDeleted) {
      this.notDeleted();
    }
    next();
  }

  schema.pre("find", applyNotDeleted);
  schema.pre("findOne", applyNotDeleted);
  schema.pre("countDocuments", applyNotDeleted);
  schema.pre("findOneAndUpdate", applyNotDeleted);
  schema.pre("findById", applyNotDeleted);

  schema.pre("aggregate", function (next) {
    if (this.options && this.options.withDeleted) return next();
    this.pipeline().unshift({
      $match: { $or: [{ isDeleted: false }, { isDeleted: { $exists: false } }] },
    });
    next();
  });

  // Instance methods
  schema.methods.softDelete = function (userId) {
    this.isDeleted = true;
    this.deletedAt = new Date();
    this.deletedBy = userId ? new Types.ObjectId(userId) : undefined;
    return this.save();
  };

  schema.methods.restore = function () {
    if (!this.isDeleted) return this; 
    this.isDeleted = false;
    this.deletedAt = undefined;
    this.deletedBy = undefined;
    return this.save();
  };

  // Static helpers
  schema.statics.findDeleted = function (
    conditions = {},
    projection = null,
    options = {}
  ) {
    return this.find({ ...conditions, isDeleted: true }, projection, options).withDeleted();
  };

  schema.statics.findOneDeleted = function (
    conditions = {},
    projection = null,
    options = {}
  ) {
    return this.findOne({ ...conditions, isDeleted: true }, projection, options).withDeleted();
  };

  schema.statics.countDocumentsDeleted = function (conditions = {}) {
    return this.countDocuments({ ...conditions, isDeleted: true }).withDeleted();
  };

  schema.statics.deleteManyDeleted = function (conditions = {}) {
    return this.deleteMany({ ...conditions, isDeleted: true }).withDeleted();
  };

  // Partial unique index helper
  // For fields with unique constraints (slug, email, token, etc.)
  schema.addPartialUnique = function (fields) {
    schema.index(fields, {
      unique: true,
      partialFilterExpression: { isDeleted: false },
    });
  };

  // Useful compound index
  schema.index({ isDeleted: 1, deletedAt: -1 });
};
