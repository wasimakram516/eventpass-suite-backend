const mongoose = require('mongoose');

const GlobalConfigSchema = new mongoose.Schema({
  appName: {
    type: String,
    required: true,
    default: "EventPass Suite"
  },

  companyLogoUrl: {
    type: String
  },

  brandingMediaUrl: {
    type: String
  },

  clientLogos: [
    {
      name: { type: String },
      logoUrl: { type: String },
      website: { type: String }
    }
  ],

  contact: {
    email: {
      type: String,
      match: /.+\@.+\..+/
    },
    phone: {
      type: String
    }
  },

  support: {
    email: {
      type: String
    },
    phone: {
      type: String
    }
  },

  poweredBy: {
    text: {
      type: String,
      default: "WhiteWall Digital Solutions"
    },
    mediaUrl: {
      type: String
    }
  },

  socialLinks: {
    facebook: { type: String },
    instagram: { type: String },
    linkedin: { type: String },
    website: { type: String }
  },

  fonts: [{
    name: { type: String, required: true },
    family: { type: String, required: true },
    files: [{
      path: { type: String, required: true },
      weight: { type: Number },
      style: { type: String, default: 'normal' }
    }]
  }]

}, { timestamps: true });

// Soft delete support
GlobalConfigSchema.plugin(require("../db/plugins/softDelete"));

module.exports = mongoose.models.GlobalConfig || mongoose.model('GlobalConfig', GlobalConfigSchema);
