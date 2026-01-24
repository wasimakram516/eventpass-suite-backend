const mongoose = require('mongoose');

const OptionSchema = new mongoose.Schema({
  text: { type: String },
  imageUrl: { type: String },
  votes: { type: Number, default: 0 }
}, { _id: false });

const PollSchema = new mongoose.Schema({
  business: { type: mongoose.Schema.Types.ObjectId, ref: 'Business', required: true },
  eventId: { type: mongoose.Schema.Types.ObjectId, ref: 'Event' },
  question: { type: String, required: true },
  options: [OptionSchema],
  type: { type: String, enum: ['options', 'slider'], default: 'options' },
}, { timestamps: true });
PollSchema.index({ business: 1, isDeleted: 1 });
PollSchema.index({ eventId: 1, isDeleted: 1 });
PollSchema.index({ createdAt: 1, isDeleted: 1 });

// Soft delete support
PollSchema.plugin(require('../db/plugins/softDelete'));

module.exports = mongoose.models.Poll || mongoose.model('Poll', PollSchema);
