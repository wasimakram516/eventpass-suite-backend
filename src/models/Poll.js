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

module.exports = mongoose.models.Poll || mongoose.model('Poll', PollSchema);
