const mongoose = require("mongoose");
const Registration = require("../../models/Registration");
const Event = require("../../models/Event");
const asyncHandler = require("../../middlewares/asyncHandler");
const response = require("../../utils/response");

// CREATE employee registration
exports.createRegistration = asyncHandler(async (req, res) => {
  const { slug, employeeId } = req.body;

  if (!slug) return response(res, 400, "Event slug is required");
  if (!employeeId) return response(res, 400, "Employee ID is required");

  const event = await Event.findOne({ slug });
  if (!event || event.eventType !== "employee") {
    return response(res, 404, "Employee event not found");
  }
  const now = new Date();
  const endOfDay = new Date(event.endDate);
  endOfDay.setUTCHours(23, 59, 59, 999);

  if (event.endDate && now > endOfDay) {
    return response(
      res,
      400,
      "Registration is closed. This event has already ended."
    );
  }

  if (event.registrations >= event.capacity) {
    return response(res, 400, "Event capacity is full");
  }

  const employee = event.employeeData.find(
    (emp) => emp.employeeId === employeeId
  );
  if (!employee) {
    return response(res, 400, "Invalid Employee ID");
  }

  const existing = await Registration.findOne({
    eventId: event._id,
    employeeId,
  });
  if (existing) {
    return response(
      res,
      200,
      `Already registered. Table: ${employee.tableNumber}`,
      {
        employeeId: existing.employeeId,
        employeeName: employee.employeeName,
        tableNumber: employee.tableNumber,
        tableImage: employee.tableImage,
      }
    );
  }

  await Registration.create({ eventId: event._id, employeeId });
  event.registrations += 1;
  await event.save();

  return response(res, 201, "Employee registration successful", {
    employeeId,
    employeeName: employee.employeeName,
    tableNumber: employee.tableNumber,
    tableImage: employee.tableImage,
  });
});

// GET paginated registrations by event using slug
exports.getRegistrationsByEvent = asyncHandler(async (req, res) => {
  const { slug } = req.params;
  const { page = 1, limit = 10 } = req.query;

  const event = await Event.findOne({ slug }).notDeleted();
  if (!event || event.eventType !== "employee") {
    return response(res, 404, "Employee event not found");
  }

  const eventId = event._id;

  const totalRegistrations = await Registration.countDocuments({ eventId }).notDeleted();
  const registrations = await Registration.find({ eventId })
    .notDeleted()
    .skip((page - 1) * limit)
    .limit(Number(limit));

  const data = registrations.map((reg) => {
    const emp = event.employeeData.find((e) => e.employeeId === reg.employeeId);
    return {
      _id: reg._id,
      employeeId: reg.employeeId,
      employeeName: emp?.employeeName || `Employee ${reg.employeeId}`,
      tableNumber: emp?.tableNumber || null,
      tableImage: emp?.tableImage || null,
      createdAt: reg.createdAt,
    };
  });

  return response(res, 200, "Registrations fetched", {
    data,
    pagination: {
      totalRegistrations,
      totalPages: Math.ceil(totalRegistrations / limit) || 1,
      currentPage: Number(page),
      perPage: Number(limit),
    },
  });
});

// GET all registrations by event using slug (for export)
exports.getAllCheckInRegistrationsByEvent = asyncHandler(async (req, res) => {
  const { slug } = req.params;

  const event = await Event.findOne({ slug }).notDeleted();
  if (!event || event.eventType !== "employee") {
    return response(res, 404, "Employee event not found");
  }

  const eventId = event._id;

  const registrations = await Registration.find({ eventId }).notDeleted();

  const enhanced = registrations.map((reg) => {
    const emp = event.employeeData.find((e) => e.employeeId === reg.employeeId);
    return {
      _id: reg._id,
      employeeId: reg.employeeId,
      employeeName: emp?.employeeName || `Employee ${reg.employeeId}`,
      tableNumber: emp?.tableNumber || null,
      tableImage: emp?.tableImage || null,
      createdAt: reg.createdAt,
    };
  });

  return response(res, 200, "All check-in registrations fetched", enhanced);
});

// SOFT DELETE registration
exports.deleteRegistration = asyncHandler(async (req, res) => {
  const { id } = req.params;
  if (!mongoose.Types.ObjectId.isValid(id)) {
    return response(res, 400, "Invalid registration ID");
  }

  const registration = await Registration.findById(id);
  if (!registration) return response(res, 404, "Registration not found");

  await registration.softDelete(req.user?._id);

  // decrement count
  await Event.findByIdAndUpdate(registration.eventId, {
    $inc: { registrations: -1 },
  });

  return response(res, 200, "Registration moved to Recycle Bin");
});

// RESTORE registration
exports.restoreRegistration = asyncHandler(async (req, res) => {
  const reg = await Registration.findOneDeleted({ _id: req.params.id });
  if (!reg) return response(res, 404, "Registration not found in trash");

  await reg.restore();
  await Event.findByIdAndUpdate(reg.eventId, {
    $inc: { registrations: 1 },
  });

  return response(res, 200, "Registration restored successfully", reg);
});

// PERMANENT DELETE registration
exports.permanentDeleteRegistration = asyncHandler(async (req, res) => {
  const reg = await Registration.findOneDeleted({ _id: req.params.id });
  if (!reg) return response(res, 404, "Registration not found in trash");

  await reg.deleteOne();
  return response(res, 200, "Registration permanently deleted");
});

// RESTORE ALL
exports.restoreAllRegistrations = asyncHandler(async (req, res) => {
  const regs = await Registration.findDeleted();
  if (!regs.length)
    return response(res, 404, "No registrations found in trash to restore");

  for (const reg of regs) {
    await reg.restore();
    await Event.findByIdAndUpdate(reg.eventId, {
      $inc: { registrations: 1 },
    });
  }

  return response(res, 200, `Restored ${regs.length} registrations`);
});

// PERMANENT DELETE ALL
exports.permanentDeleteAllRegistrations = asyncHandler(async (req, res) => {
  const regs = await Registration.findDeleted();
  if (!regs.length)
    return response(res, 404, "No registrations found in trash to delete");

  await Registration.deleteManyDeleted();

  return response(res, 200, `Permanently deleted ${regs.length} registrations`);
});

