const { Schema, Types } = require("mongoose");

function toObjectId(value) {
  if (value == null) return undefined;
  if (value instanceof Types.ObjectId) return value;
  if (typeof value === "object" && value._id) return toObjectId(value._id);
  return new Types.ObjectId(value);
}

function auditUser(schema) {
  schema.add({
    createdBy: { type: Schema.Types.ObjectId, ref: "User", default: null },
    updatedBy: { type: Schema.Types.ObjectId, ref: "User", default: null },
  });

  schema.pre("save", function (next) {
    const uid = this._auditUserId;
    if (uid != null) {
      const id = toObjectId(uid);
      if (this.isNew) {
        this.createdBy = id;
      } else {
        this.updatedBy = id;
      }
      delete this._auditUserId;
    }
    if (this.isNew && this.updatedAt !== undefined) {
      this.updatedAt = undefined;
    }
    next();
  });

  schema.methods.setAuditUser = function (userIdOrUser) {
    const id = userIdOrUser != null ? (userIdOrUser._id ?? userIdOrUser) : null;
    const oid = id != null ? toObjectId(id) : null;
    this._auditUserId = oid;
    if (oid != null) {
      if (this.isNew) {
        this.createdBy = oid;
      } else {
        this.updatedBy = oid;
      }
    }
    return this;
  };

  schema.statics.createWithAuditUser = async function (docOrDocs, userIdOrUser) {
    const id = userIdOrUser != null ? toObjectId(userIdOrUser._id ?? userIdOrUser) : null;
    const arr = Array.isArray(docOrDocs) ? docOrDocs : [docOrDocs];
    const single = !Array.isArray(docOrDocs);
    const results = [];
    for (const doc of arr) {
      const instance = new this(doc);
      if (id) instance.setAuditUser(id);
      const saved = await instance.save();
      results.push(saved);
    }
    return single ? results[0] : results;
  };

  schema.statics.addUpdatedByToUpdate = function (update, userIdOrUser) {
    const id = userIdOrUser != null ? toObjectId(userIdOrUser._id ?? userIdOrUser) : null;
    if (id == null) return update;
    const out = update && typeof update === "object" ? { ...update } : {};
    out.$set = out.$set && typeof out.$set === "object" ? { ...out.$set } : {};
    out.$set.updatedBy = id;
    return out;
  };
}

auditUser.toObjectId = toObjectId;
module.exports = auditUser;
