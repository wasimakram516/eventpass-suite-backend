const Visitor = require("../../models/Visitor");
const response = require("../../utils/response");
const asyncHandler = require("../../middlewares/asyncHandler");

// GET all visitors with populated eventHistory
exports.getAllVisitors = asyncHandler(async (req, res) => {
  const user = req.user;

  if (!["admin", "business"].includes(user.role)) {
    return response(res, 403, "Unauthorized");
  }

  const visitors = await Visitor.find().notDeleted()
    .populate("eventHistory.business", "name")
    .sort({ createdAt: -1 });

  return response(res, 200, "Visitors fetched", visitors);
});
