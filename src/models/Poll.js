const mongoose = require('mongoose');

const OptionSchema = new mongoose.Schema({
  text: { type: String, required: true },
  imageUrl: { type: String },
  votes: { type: Number, default: 0 }
}, { _id: false });

const PollSchema = new mongoose.Schema({
  business: { type: mongoose.Schema.Types.ObjectId, ref: 'Business', required: true },
  question: { type: String, required: true },
  options: [OptionSchema],
  status: { type: String, enum: ['active', 'archived'], default: 'active' },
  type: { type: String, enum: ['options', 'slider'], default: 'options' },
}, { timestamps: true });
PollSchema.index({ business: 1, isDeleted: 1 });
PollSchema.index({ createdAt: 1, isDeleted: 1 });

// Soft delete support
PollSchema.plugin(require('../db/plugins/softDelete'));
PollSchema.plugin(require('../db/plugins/auditUser'));

module.exports = mongoose.models.Poll || mongoose.model('Poll', PollSchema);
