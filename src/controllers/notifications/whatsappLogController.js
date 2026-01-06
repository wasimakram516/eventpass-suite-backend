const WhatsAppMessageLog = require("../../models/WhatsAppMessageLog");
const response = require("../../utils/response");
const asyncHandler = require("../../middlewares/asyncHandler");

/**
 * =========================================
 * GET WHATSAPP LOGS (PAGINATED)
 * =========================================
 */
exports.getWhatsAppLogs = asyncHandler(async (req, res) => {
  const {
    eventId,
    registrationId,
    businessId,
    token,
    to,
    status,
    direction,
    page = 1,
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

  const pageNum = Math.max(Number(page), 1);
  const limitNum = Math.min(Number(limit), 100); // hard cap for safety
  const skip = (pageNum - 1) * limitNum;

  const [logs, total] = await Promise.all([
    WhatsAppMessageLog.find(filter)
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limitNum)
      .populate("registrationId", "name phone")
      .populate("eventId", "name slug"),

    WhatsAppMessageLog.countDocuments(filter),
  ]);

  return response(res, 200, "WhatsApp logs fetched", {
    data: logs,
    pagination: {
      total,
      page: pageNum,
      limit: limitNum,
      totalPages: Math.ceil(total / limitNum),
      hasNextPage: skip + logs.length < total,
      hasPrevPage: pageNum > 1,
    },
  });
});

/**
 * =========================================
 * GET WHATSAPP LOGS BY REGISTRATION (PAGINATED)
 * =========================================
 */
exports.getWhatsAppLogsByRegistration = asyncHandler(async (req, res) => {
  const { registrationId } = req.params;
  const { page = 1, limit = 20 } = req.query;

  const pageNum = Math.max(Number(page), 1);
  const limitNum = Math.min(Number(limit), 50);
  const skip = (pageNum - 1) * limitNum;

  const [logs, total] = await Promise.all([
    WhatsAppMessageLog.find({ registrationId })
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limitNum),

    WhatsAppMessageLog.countDocuments({ registrationId }),
  ]);

  return response(res, 200, "WhatsApp logs fetched", {
    data: logs,
    pagination: {
      total,
      page: pageNum,
      limit: limitNum,
      totalPages: Math.ceil(total / limitNum),
      hasNextPage: skip + logs.length < total,
      hasPrevPage: pageNum > 1,
    },
  });
});

/**
 * =========================================
 * GET SINGLE WHATSAPP LOG
 * =========================================
 */
exports.getWhatsAppLogById = asyncHandler(async (req, res) => {
  const log = await WhatsAppMessageLog.findById(req.params.id)
    .populate("registrationId", "name phone")
    .populate("eventId", "name slug");

  if (!log) {
    return response(res, 404, "WhatsApp log not found");
  }

  return response(res, 200, "WhatsApp log fetched", log);
});
