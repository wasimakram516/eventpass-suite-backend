const mongoose = require('mongoose');

const OptionSchema = new mongoose.Schema({
  text: { type: String },
  imageUrl: { type: String },
  votes: { type: Number, default: 0 }
}, { _id: false });

const QuestionSchema = new mongoose.Schema({
  question: { type: String, required: true },
  options: [OptionSchema],
  createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
  updatedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
  createdAt: { type: Date, default: null },
  updatedAt: { type: Date, default: null },
}, { _id: true });

const PollSchema = new mongoose.Schema({
  business: { type: mongoose.Schema.Types.ObjectId, ref: 'Business', required: true },
  eventId: { type: mongoose.Schema.Types.ObjectId, ref: 'Event' }, // kept for backward compat
  linkedEventRegId: { type: mongoose.Schema.Types.ObjectId, ref: 'Event', default: null },
  title: { type: String, required: true },
  slug: { type: String, required: true },
  description: { type: String, default: '' },
  type: { type: String, enum: ['options', 'slider'], default: 'options' },
  primaryField: { type: String, default: null },
  logoUrl: { type: String, default: null },
  background: {
    en: { url: { type: String, default: null }, fileType: { type: String, enum: ['image', 'video'], default: null } },
    ar: { url: { type: String, default: null }, fileType: { type: String, enum: ['image', 'video'], default: null } },
  },
  questions: [QuestionSchema],
}, { timestamps: true });

PollSchema.index({ business: 1 });
PollSchema.index({ slug: 1 }, { unique: true });

PollSchema.plugin(require('../db/plugins/softDelete'));
PollSchema.plugin(require('../db/plugins/auditUser'));

module.exports = mongoose.models.Poll || mongoose.model('Poll', PollSchema);
