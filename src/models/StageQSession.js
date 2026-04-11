const mongoose = require('mongoose');

const StageQSessionSchema = new mongoose.Schema({
  business: { type: mongoose.Schema.Types.ObjectId, ref: 'Business', required: true },
  linkedEventRegId: { type: mongoose.Schema.Types.ObjectId, ref: 'Event', default: null },
  title: { type: String, required: true },
  slug: { type: String, required: true },
  description: { type: String, default: '' },
  primaryField: { type: String, default: null },
}, { timestamps: true });

StageQSessionSchema.index({ business: 1 });
StageQSessionSchema.index({ slug: 1 }, { unique: true });

StageQSessionSchema.plugin(require('../db/plugins/softDelete'));
StageQSessionSchema.plugin(require('../db/plugins/auditUser'));

module.exports = mongoose.models.StageQSession || mongoose.model('StageQSession', StageQSessionSchema);
