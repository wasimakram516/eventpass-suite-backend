const WhatsAppMessageLog = require("../../models/WhatsAppMessageLog");
const Registration = require("../../models/Registration");
const {
  emitWhatsAppStatusUpdate,
  emitWhatsAppInboundMessage,
} = require("../../socket/modules/notifications/whatsappSocket");
const { sendCustomWhatsApp } = require("../../services/whatsappService");

/**
 * =========================================
 * Twilio WhatsApp STATUS webhook
 * Handles: sent, delivered, read, failed, undelivered
 * =========================================
 */
exports.twilioWhatsAppStatusWebhook = async (req, res) => {
  try {
    const { MessageSid, MessageStatus, ErrorCode, ErrorMessage } = req.body;

    // Twilio retries → always respond 200
    if (!MessageSid || !MessageStatus) {
      return res.sendStatus(200);
    }

    const update = {
      status: MessageStatus,
      updatedAt: new Date(),
    };

    /* ===========================
       STATUS → TIMESTAMP MAPPING
    ============================ */

    if (MessageStatus === "sent") {
      update.sentAt = new Date();
    }

    if (MessageStatus === "delivered") {
      update.deliveredAt = new Date();
    }

    if (MessageStatus === "read") {
      update.readAt = new Date();
    }

    if (["failed", "undelivered"].includes(MessageStatus)) {
      update.failedAt = new Date();
      update.errorCode = ErrorCode?.toString() || null;
      update.errorMessage = ErrorMessage || null;
    }

    /* ===========================
       UPDATE LOG (IDEMPOTENT)
    ============================ */

    const log = await WhatsAppMessageLog.findOneAndUpdate(
      { messageSid: MessageSid },
      {
        $set: update,
        $push: { rawWebhooks: req.body },
      },
      { new: true }
    );

    // Log may not exist yet due to race conditions
    if (!log) {
      return res.sendStatus(200);
    }

    /* ===========================
       SOCKET EMIT (STATUS UPDATE)
    ============================ */

    if (log.eventId) {
      emitWhatsAppStatusUpdate(log.eventId, {
        messageSid: log.messageSid,
        status: log.status,
        deliveredAt: log.deliveredAt,
        readAt: log.readAt,
        failedAt: log.failedAt,
      });
    }

    return res.sendStatus(200);
  } catch (err) {
    // Never fail webhook
    return res.sendStatus(200);
  }
};

/**
 * =========================================
 * Twilio WhatsApp INBOUND webhook
 * Handles user replies
 * =========================================
 */
exports.twilioWhatsAppInboundWebhook = async (req, res) => {
  try {
    const { MessageSid, From, To, Body, WaId, NumMedia } = req.body;

    if (!MessageSid || !From) {
      return res.sendStatus(200);
    }

    /* ===========================
       IDEMPOTENCY CHECK
    ============================ */

    const existing = await WhatsAppMessageLog.findOne({
      messageSid: MessageSid,
      direction: "inbound",
    });

    if (existing) {
      return res.sendStatus(200);
    }

    /* ===========================
       MEDIA EXTRACTION
    ============================ */

    const mediaUrls = [];
    const mediaCount = parseInt(NumMedia || "0", 10);

    for (let i = 0; i < mediaCount; i++) {
      const mediaUrl = req.body[`MediaUrl${i}`];
      if (mediaUrl) mediaUrls.push(mediaUrl);
    }

    /* ===========================
       CREATE INBOUND LOG
    ============================ */

    const log = await WhatsAppMessageLog.create({
      direction: "inbound",
      type: "reply",

      messageSid: MessageSid,
      from: From,
      to: To,
      waId: WaId || null,

      body: Body || null,
      mediaUrls,

      status: "received",
      receivedAt: new Date(),

      rawWebhooks: [req.body],
    });

    /* ===========================
       LINK TO REGISTRATION (BEST-EFFORT)
    ============================ */

    const normalizedPhone = From.replace("whatsapp:", "").trim();

    const registration = await Registration.findOne({
      phone: normalizedPhone,
    }).select("_id eventId businessId");

    if (registration) {
      log.registrationId = registration._id;
      log.eventId = registration.eventId;
      log.businessId = registration.businessId;
      await log.save();
    }

    /* ===========================
       SOCKET EMIT (INBOUND MESSAGE)
    ============================ */

    if (log.eventId) {
      emitWhatsAppInboundMessage(log.eventId, {
        messageSid: log.messageSid,
        from: log.from,
        body: log.body,
        mediaUrls: log.mediaUrls,
        receivedAt: log.receivedAt,
      });
    }

    /* ===========================
      GENERIC AUTO-REPLY (ONE-TIME)
    ============================ */

    const alreadyReplied = await WhatsAppMessageLog.exists({
      direction: "outbound",
      type: "custom",
      to: From,
      body: "Thanks for reaching out. Our team has received your message and will get back to you shortly.",
    });

    if (!alreadyReplied) {
      await sendCustomWhatsApp(
        From,
        null,
        "Thanks for reaching out. Our team has received your message and will get back to you shortly.",
        {
          eventId: log.eventId,
          registrationId: log.registrationId,
          businessId: log.businessId,
          token: log.token,
        }
      );
    }

    return res.sendStatus(200);
  } catch (err) {
    // Never fail inbound webhook
    return res.sendStatus(200);
  }
};
