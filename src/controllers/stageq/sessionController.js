const mongoose = require("mongoose");
const StageQSession = require("../../models/StageQSession");
const Event = require("../../models/Event");
const Business = require("../../models/Business");
const Registration = require("../../models/Registration");
const asyncHandler = require("../../middlewares/asyncHandler");
const response = require("../../utils/response");
const { recomputeAndEmit } = require("../../socket/dashboardSocket");

// GET all sessions by businessSlug
exports.getSessions = asyncHandler(async (req, res) => {
  const { businessSlug } = req.query;
  if (!businessSlug) return response(res, 400, "businessSlug is required");

  const business = await Business.findOne({ slug: businessSlug });
  if (!business) return response(res, 404, "Business not found");

  const sessions = await StageQSession.find({ business: business._id })
    .populate("createdBy", "name")
    .populate("updatedBy", "name")
    .populate("linkedEventRegId", "name slug logoUrl");

  const sessionIds = sessions.map(s => s._id);
  const EventQuestion = require("../../models/EventQuestion");
  const counts = await EventQuestion.aggregate([
    { $match: { sessionId: { $in: sessionIds }, deletedAt: { $exists: false } } },
    { $group: { _id: "$sessionId", count: { $sum: 1 } } },
  ]);
  const countMap = Object.fromEntries(counts.map(c => [c._id.toString(), c.count]));

  const result = sessions.map(s => ({
    ...s.toObject(),
    questionCount: countMap[s._id.toString()] || 0,
  }));

  return response(res, 200, "Sessions fetched", result);
});

// GET session by slug (public)
exports.getSessionBySlug = asyncHandler(async (req, res) => {
  const { slug } = req.params;
  const session = await StageQSession.findOne({ slug })
    .populate("linkedEventRegId", "name slug logoUrl backgroundImage backgroundVideo backgroundImageAr backgroundVideoAr");
  if (!session) return response(res, 404, "Session not found");
  return response(res, 200, "Session fetched", session);
});

// POST create session
exports.createSession = asyncHandler(async (req, res) => {
  const { title, slug, description, linkedEventRegId, businessSlug, primaryField } = req.body;
  const user = req.user;

  if (!title) return response(res, 400, "Title is required");

  let businessId;
  if (linkedEventRegId) {
    if (!mongoose.Types.ObjectId.isValid(linkedEventRegId)) return response(res, 400, "Invalid linkedEventRegId");
    const linkedEvent = await Event.findById(linkedEventRegId);
    if (!linkedEvent) return response(res, 404, "Linked EventReg event not found");
    businessId = linkedEvent.businessId;
  } else if (businessSlug) {
    const business = await Business.findOne({ slug: businessSlug });
    if (!business) return response(res, 404, "Business not found");
    businessId = business._id;
  } else {
    businessId = user.business?._id || user.business;
    if (!businessId) return response(res, 400, "Business could not be determined");
  }

  const sessionSlug = slug || title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
  const existing = await StageQSession.findOne({ slug: sessionSlug });
  if (existing) return response(res, 400, "Slug already in use");

  const session = await StageQSession.createWithAuditUser({
    title,
    slug: sessionSlug,
    description: description || "",
    business: businessId,
    linkedEventRegId: linkedEventRegId || null,
    primaryField: primaryField || null,
  }, req.user);

  recomputeAndEmit(businessId || null).catch(err => console.error("Background recompute failed:", err.message));

  const populated = await StageQSession.findById(session._id)
    .populate("createdBy", "name")
    .populate("updatedBy", "name")
    .populate("linkedEventRegId", "name slug logoUrl");
  return response(res, 201, "Session created", populated || session);
});

// PUT update session
exports.updateSession = asyncHandler(async (req, res) => {
  const { id } = req.params;
  const { title, slug, description, primaryField, linkedEventRegId } = req.body;
  const user = req.user;

  const session = await StageQSession.findById(id);
  if (!session) return response(res, 404, "Session not found");

  const isAdmin = ["admin", "superadmin"].includes(user.role);
  const isOwner = String(session.business) === String(user.business?._id || user.business);
  if (!isAdmin && !isOwner) return response(res, 403, "Permission denied");

  if (title !== undefined) session.title = title;
  if (description !== undefined) session.description = description;
  if (primaryField !== undefined) session.primaryField = primaryField || null;
  if (linkedEventRegId !== undefined) session.linkedEventRegId = linkedEventRegId || null;

  if (slug !== undefined && slug !== session.slug) {
    const existing = await StageQSession.findOne({ slug, _id: { $ne: id } });
    if (existing) return response(res, 400, "Slug already in use");
    session.slug = slug;
  }

  session.setAuditUser(req.user);
  await session.save();

  recomputeAndEmit(session.business || null).catch(err => console.error("Background recompute failed:", err.message));

  const populated = await StageQSession.findById(session._id)
    .populate("createdBy", "name")
    .populate("updatedBy", "name")
    .populate("linkedEventRegId", "name slug logoUrl");
  return response(res, 200, "Session updated", populated || session);
});

// DELETE session (soft)
exports.deleteSession = asyncHandler(async (req, res) => {
  const { id } = req.params;
  const user = req.user;

  const session = await StageQSession.findById(id);
  if (!session) return response(res, 404, "Session not found");

  const isAdmin = ["admin", "superadmin"].includes(user.role);
  const isOwner = String(session.business) === String(user.business?._id || user.business);
  if (!isAdmin && !isOwner) return response(res, 403, "Permission denied");

  await session.softDelete(req.user.id);

  recomputeAndEmit(session.business || null).catch(err => console.error("Background recompute failed:", err.message));

  return response(res, 200, "Session moved to recycle bin");
});

// POST verify attendee by session slug
exports.verifyAttendeeBySession = asyncHandler(async (req, res) => {
  const { slug } = req.params;
  const { fieldValue } = req.body;
  if (!fieldValue) return response(res, 400, "fieldValue is required");

  const session = await StageQSession.findOne({ slug }).select("linkedEventRegId primaryField").lean();
  if (!session) return response(res, 404, "Session not found");

  if (!session.linkedEventRegId || !session.primaryField) {
    return response(res, 400, "This session does not require identity verification");
  }

  const primaryField = session.primaryField;
  const linkedEvent = await Event.findById(session.linkedEventRegId).select("formFields").lean();
  if (!linkedEvent) return response(res, 404, "Linked EventReg event not found");

  const isCustomField = linkedEvent.formFields?.some(f => f.inputName === primaryField);
  const query = { eventId: session.linkedEventRegId, deletedAt: { $exists: false } };
  if (isCustomField) {
    query[`customFields.${primaryField}`] = fieldValue;
  } else {
    query[primaryField] = fieldValue;
  }

  const registration = await Registration.findOne(query)
    .select("_id fullName company customFields")
    .lean();
  if (!registration) return response(res, 404, "No matching registration found");

  let displayName = registration.fullName || null;
  let displayCompany = registration.company || null;
  if (!displayName && registration.customFields) {
    const nameKeys = ["Name", "name", "fullName", "FullName", "full_name"];
    for (const key of nameKeys) {
      if (registration.customFields[key]) { displayName = registration.customFields[key]; break; }
    }
  }
  if (!displayCompany && registration.customFields) {
    const companyKeys = ["Company", "company", "organization", "Organization"];
    for (const key of companyKeys) {
      if (registration.customFields[key]) { displayCompany = registration.customFields[key]; break; }
    }
  }

  return response(res, 200, "Attendee verified", {
    registrationId: registration._id,
    fullName: displayName,
    company: displayCompany,
  });
});
