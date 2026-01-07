const WhatsAppMessageLog = require("../../models/WhatsAppMessageLog");
const response = require("../../utils/response");
const asyncHandler = require("../../middlewares/asyncHandler");
const { sendCustomWhatsApp } = require("../../services/whatsappService");
const mongoose = require("mongoose");

/* ======================================================
   GET INBOX (GROUPED BY CONVERSATION PHONE)
====================================================== */
exports.getWhatsAppInbox = asyncHandler(async (req, res) => {
  const eventId = req.query.eventId || req.query.eventid;
  const { businessId } = req.query;

  if (!eventId && !businessId) {
    return response(res, 400, "eventId or businessId is required");
  }

  const match = {};

  if (eventId) {
    match.eventId = new mongoose.Types.ObjectId(eventId);
  }

  if (businessId) {
    match.businessId = new mongoose.Types.ObjectId(businessId);
  }

  const inbox = await WhatsAppMessageLog.aggregate([
    { $match: match },
    { $sort: { createdAt: -1 } },
    {
      $group: {
        _id: {
          $cond: [
            { $eq: ["$direction", "inbound"] },
            "$from",
            "$to",
          ],
        },
        phone: {
          $first: {
            $cond: [
              { $eq: ["$direction", "inbound"] },
              "$from",
              "$to",
            ],
          },
        },
        lastMessage: { $first: "$body" },
        lastDirection: { $first: "$direction" },
        lastStatus: { $first: "$status" },
        lastMessageAt: { $first: "$createdAt" },
        eventId: { $first: "$eventId" },
        registrationId: { $first: "$registrationId" },
        unreadCount: {
          $sum: {
            $cond: [{ $eq: ["$direction", "inbound"] }, 1, 0],
          },
        },
      },
    },
    { $sort: { lastMessageAt: -1 } },
  ]);

  return response(res, 200, "WhatsApp inbox fetched", inbox);
});

/* ======================================================
   GET CONVERSATION (ONE PHONE, BOTH DIRECTIONS)
====================================================== */
exports.getWhatsAppConversation = asyncHandler(async (req, res) => {
  const { eventId, to, limit = 50 } = req.query;

  if (!eventId || !to) {
    return response(res, 400, "eventId and to are required");
  }

  const messages = await WhatsAppMessageLog.find({
    eventId,
    $or: [
      { to },
      { from: to },
    ],
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

  if (!eventId || !businessId || !to || !body) {
    return response(
      res,
      400,
      "eventId, businessId, recipient and body are required"
    );
  }

  // Send custom WhatsApp text
  const providerRes = await sendCustomWhatsApp(
    to,
    null,           // no media
    body,
    {
      eventId,
      businessId,
      registrationId,
    }
  );

  if (!providerRes?.success) {
    return response(res, 500, "Failed to send WhatsApp reply", providerRes);
  }

  return response(res, 201, "Reply sent", {
    messageSid: providerRes.messageSid,
  });
});
