const WhatsAppMessageLog = require("../../models/WhatsAppMessageLog");
const response = require("../../utils/response");
const asyncHandler = require("../../middlewares/asyncHandler");

exports.getWhatsAppLogs = asyncHandler(async (req, res) => {
  const {
    eventId,
    registrationId,
    businessId,
    token,
    to,
    status,
    direction,
    limit = 50,
  } = req.query;

  const filter = {};

  if (eventId) filter.eventId = eventId;
  if (registrationId) filter.registrationId = registrationId;
  if (businessId) filter.businessId = businessId;
  if (token) filter.token = token;
  if (to) filter.to = to;
  if (status) filter.status = status;
  if (direction) filter.direction = direction;

  const logs = await WhatsAppMessageLog.find(filter)
    .sort({ createdAt: -1 })
    .limit(Number(limit))
    .populate("registrationId", "name phone")
    .populate("eventId", "name slug");

  return response(res, 200, "WhatsApp logs fetched", logs);
});

exports.getWhatsAppLogsByRegistration = asyncHandler(async (req, res) => {
  const { registrationId } = req.params;

  const logs = await WhatsAppMessageLog.find({ registrationId })
    .sort({ createdAt: -1 })
    .limit(20);

  return response(res, 200, "WhatsApp logs fetched", logs);
});

exports.getWhatsAppLogById = asyncHandler(async (req, res) => {
  const log = await WhatsAppMessageLog.findById(req.params.id)
    .populate("registrationId", "name phone")
    .populate("eventId", "name slug");

  if (!log) return response(res, 404, "WhatsApp log not found");

  return response(res, 200, "WhatsApp log fetched", log);
});
