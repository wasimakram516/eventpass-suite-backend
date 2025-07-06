const mongoose = require('mongoose');

const BusinessSchema = new mongoose.Schema({
  name: { type: String, required: true },
  slug: { type: String, required: true, unique: true },
  logoUrl: { type: String },
  owner: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  contact: {
    email: {
      type: String,
      match: /.+\@.+\..+/
    },
    phone: {
      type: String
    }
  },
  address: { type: String }, 
}, { timestamps: true });

module.exports = mongoose.models.Business || mongoose.model('Business', BusinessSchema);
