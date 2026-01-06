const WhatsAppMessageLog = require("../../models/WhatsAppMessageLog");
const response = require("../../utils/response");
const asyncHandler = require("../../middlewares/asyncHandler");
const { sendWhatsAppTextMessage } = require("../../services/whatsappService");

/* ======================================================
   GET INBOX (GROUPED BY PHONE)
====================================================== */
exports.getWhatsAppInbox = asyncHandler(async (req, res) => {
  const { eventId, businessId } = req.query;

  if (!eventId && !businessId) {
    return response(res, 400, "eventId or businessId is required");
  }

  const match = {};
  if (eventId) match.eventId = eventId;
  if (businessId) match.businessId = businessId;

  const inbox = await WhatsAppMessageLog.aggregate([
    { $match: match },
    { $sort: { createdAt: -1 } },
    {
      $group: {
        _id: "$to",
        lastMessage: { $first: "$body" },
        lastDirection: { $first: "$direction" },
        lastStatus: { $first: "$status" },
        lastMessageAt: { $first: "$createdAt" },
        eventId: { $first: "$eventId" },
        registrationId: { $first: "$registrationId" },
        unreadCount: {
          $sum: {
            $cond: [
              { $eq: ["$direction", "inbound"] },
              1,
              0,
            ],
          },
        },
      },
    },
    { $sort: { lastMessageAt: -1 } },
  ]);

  return response(res, 200, "WhatsApp inbox fetched", inbox);
});

/* ======================================================
   GET CONVERSATION (ONE PHONE)
====================================================== */
exports.getWhatsAppConversation = asyncHandler(async (req, res) => {
  const { eventId, to, limit = 50 } = req.query;

  if (!eventId || !to) {
    return response(res, 400, "eventId and to are required");
  }

  const messages = await WhatsAppMessageLog.find({
    eventId,
    to,
  })
    .sort({ createdAt: 1 })
    .limit(Number(limit))
    .populate("registrationId", "fullName phone email")
    .populate("eventId", "name slug");

  return response(res, 200, "Conversation fetched", messages);
});

/* ======================================================
   SEND MANUAL REPLY (ADMIN)
====================================================== */
exports.sendWhatsAppReply = asyncHandler(async (req, res) => {
  const {
    eventId,
    businessId,
    registrationId,
    to,
    body,
  } = req.body;

  if (!to || !body) {
    return response(res, 400, "Recipient and message body are required");
  }

  // Send via WhatsApp provider
  const providerRes = await sendWhatsAppTextMessage({
    to,
    body,
  });

  // Log outbound message
  const log = await WhatsAppMessageLog.create({
    eventId,
    businessId,
    registrationId,
    to,
    body,
    direction: "outbound",
    type: "reply",
    status: providerRes?.status || "sent",
    providerMessageId: providerRes?.messageId,
  });

  return response(res, 201, "Reply sent", log);
});
