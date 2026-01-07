const mongoose = require("mongoose");

const WhatsAppMessageLogSchema = new mongoose.Schema(
  {
    /* ===========================
       CORE RELATIONSHIP CONTEXT
    ============================ */

    eventId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Event",
      index: true,
    },

    registrationId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Registration",
      index: true,
    },

    businessId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Business",
      index: true,
    },

    token: {
      type: String,
      index: true,
    },

    /* ===========================
       MESSAGE DIRECTION & CHANNEL
    ============================ */

    channel: {
      type: String,
      enum: ["whatsapp"],
      default: "whatsapp",
      index: true,
    },

    direction: {
      type: String,
      enum: ["outbound", "inbound"],
      required: true,
      index: true,
    },

    type: {
      type: String,
      enum: ["template", "custom", "reply", "auto_reply"],
      index: true,
    },

    /* ===========================
       ADDRESSING
    ============================ */

    from: {
      type: String,
      index: true,
    },

    to: {
      type: String,
      index: true,
    },

    waId: {
      type: String, // WhatsApp user ID (from inbound messages)
      index: true,
    },

    /* ===========================
       TWILIO IDENTIFIERS (CRITICAL)
    ============================ */

    messageSid: {
      type: String, // Twilio MessageSid (PRIMARY JOIN KEY)
      unique: true,
      sparse: true,
      index: true,
    },

    contentSid: {
      type: String, // Template SID (outbound only)
      index: true,
    },

    /* ===========================
       CONTENT
    ============================ */

    contentVariables: {
      type: Object, // Parsed JSON for templates
    },

    body: {
      type: String, // Custom messages or inbound replies
    },

    mediaUrls: [
      {
        type: String,
      },
    ],

    /* ===========================
       DELIVERY STATE (SOURCE OF TRUTH)
    ============================ */

    status: {
      type: String,
      enum: [
        "queued", // Created, sent to Twilio
        "sent", // Accepted by WhatsApp
        "delivered", // Delivered to device
        "read", // User opened
        "failed", // Permanently failed
        "undelivered", // Not delivered
        "received", // Inbound message received
      ],
      index: true,
    },

    /* ===========================
       TIMESTAMPS (STATE EVOLUTION)
    ============================ */

    attemptedAt: {
      type: Date,
      index: true,
    },

    sentAt: Date,
    deliveredAt: Date,
    readAt: Date,
    failedAt: Date,
    receivedAt: Date,

    /* ===========================
       ERROR DETAILS (FAILURES ONLY)
    ============================ */

    errorCode: {
      type: String,
      index: true,
    },

    errorMessage: {
      type: String,
    },

    httpStatus: Number,

    /* ===========================
       RAW PAYLOADS (AUDIT + DEBUG)
    ============================ */

    rawWebhooks: [
      {
        type: mongoose.Schema.Types.Mixed,
      },
    ],

    rawResponse: {
      type: mongoose.Schema.Types.Mixed,
    },
  },
  {
    timestamps: true,
  }
);

/* ===========================
   INDEXES FOR SCALE
=========================== */

// High-volume lookups
WhatsAppMessageLogSchema.index({ eventId: 1, createdAt: -1 });
WhatsAppMessageLogSchema.index({ registrationId: 1, createdAt: -1 });
WhatsAppMessageLogSchema.index({ messageSid: 1 });

// UI filtering
WhatsAppMessageLogSchema.index({ status: 1, createdAt: -1 });
WhatsAppMessageLogSchema.index({ direction: 1, createdAt: -1 });

module.exports = mongoose.model("WhatsAppMessageLog", WhatsAppMessageLogSchema);
