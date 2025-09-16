const mongoose = require("mongoose");
const Registration = require("../../models/Registration");
const Event = require("../../models/Event");
const asyncHandler = require("../../middlewares/asyncHandler");
const response = require("../../utils/response");
const WalkIn = require("../../models/WalkIn");
const { buildBadgeZpl } = require("../../utils/zebraZpl");
const { recomputeAndEmit } = require("../../socket/dashboardSocket");

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
    return response(res, 400, "Registration is closed. Event ended.");
  }

  if (event.registrations >= event.capacity) {
    return response(res, 400, "Event capacity is full");
  }

  const employee = event.employeeData.find((emp) => emp.employeeId === employeeId);
  if (!employee) {
    return response(res, 400, "Invalid Employee ID");
  }

  // check existing
  let reg = await Registration.findOne({ eventId: event._id, employeeId });
  if (reg) {
    return response(res, 200, `Already registered. Table: ${employee.tableNumber}`, {
      employeeId: reg.employeeId,
      employeeName: employee.employeeName,
      tableNumber: employee.tableNumber,
      tableImage: employee.tableImage,
      token: reg.token,
      showQrAfterRegistration: event.showQrAfterRegistration !== false,
    });
  }

  reg = await Registration.create({ eventId: event._id, employeeId });
  event.registrations += 1;
  await event.save();

  // Fire background recompute
  recomputeAndEmit(event.businessId || null).catch((err) =>
    console.error("Background recompute failed:", err.message)
  );

  return response(res, 201, "Employee registration successful", {
  employeeId,
  employeeName: employee.employeeName,
  tableNumber: employee.tableNumber,
  tableImage: employee.tableImage,
  token: reg.token,
  showQrAfterRegistration: event.showQrAfterRegistration !== false,
});
});

// VERIFY employee registration by QR token and create a WalkIn
exports.verifyRegistrationByToken = asyncHandler(async (req, res) => {
  const { token } = req.query;
  const staffUser = req.user;

  if (!token) return response(res, 400, "Token is required");
  if (!staffUser?.id) return response(res, 401, "Unauthorized – no scanner info");

  const reg = await Registration.findOne({ token }).populate("eventId");
  if (!reg || reg.eventId?.eventType !== "employee") {
    return response(res, 404, "Registration not found for employee event");
  }

  const employee = reg.eventId.employeeData.find((e) => e.employeeId === reg.employeeId);

  const walkin = new WalkIn({
    registrationId: reg._id,
    eventId: reg.eventId._id,
    scannedBy: staffUser.id,
  });
  await walkin.save();

  // Badge ZPL for printer
  const zpl = buildBadgeZpl({
    fullName: employee?.employeeName || `Employee ${reg.employeeId}`,
    company: "",
    eventName: reg.eventId?.name,
    token: reg.token,
  });

  // Fire background recompute
  recomputeAndEmit(reg.eventId.businessId || null).catch((err) =>
    console.error("Background recompute failed:", err.message)
  );
  
  return response(res, 200, "Registration verified and walk-in recorded", {
    employeeId: reg.employeeId,
    employeeName: employee?.employeeName,
    tableNumber: employee?.tableNumber,
    tableImage: employee?.tableImage,
    eventName: reg.eventId?.name,
    token: reg.token,
    walkinId: walkin._id,
    scannedAt: walkin.scannedAt,
    scannedBy: {
      name: staffUser.name || staffUser.email,
    },
    zpl,
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

  const enhanced = await Promise.all(
    registrations.map(async (reg) => {
      const emp = event.employeeData.find((e) => e.employeeId === reg.employeeId);

      const walkIns = await WalkIn.find({ registrationId: reg._id })
        .populate("scannedBy", "name email")
        .sort({ scannedAt: -1 });

      return {
        _id: reg._id,
        employeeId: reg.employeeId,
        employeeName: emp?.employeeName || `Employee ${reg.employeeId}`,
        tableNumber: emp?.tableNumber || null,
        tableImage: emp?.tableImage || null,
        createdAt: reg.createdAt,
        token: reg.token,
        walkIns: walkIns.map((w) => ({
          scannedAt: w.scannedAt,
          scannedBy: w.scannedBy,
        })),
      };
    })
  );

  return response(res, 200, "Registrations fetched", {
    data: enhanced,
    pagination: {
      totalRegistrations,
      totalPages: Math.ceil(totalRegistrations / limit) || 1,
      currentPage: Number(page),
      perPage: Number(limit),
    },
  });
});

// GET all registrations by event using slug (for export, includes walk-ins)
exports.getAllCheckInRegistrationsByEvent = asyncHandler(async (req, res) => {
  const { slug } = req.params;

  const event = await Event.findOne({ slug }).notDeleted();
  if (!event || event.eventType !== "employee") {
    return response(res, 404, "Employee event not found");
  }

  const eventId = event._id;

  const registrations = await Registration.find({ eventId }).notDeleted();

  const enhanced = await Promise.all(
    registrations.map(async (reg) => {
      const emp = event.employeeData.find((e) => e.employeeId === reg.employeeId);

      const walkIns = await WalkIn.find({ registrationId: reg._id })
        .populate("scannedBy", "name email")
        .sort({ scannedAt: -1 });

      return {
        _id: reg._id,
        employeeId: reg.employeeId,
        employeeName: emp?.employeeName || `Employee ${reg.employeeId}`,
        tableNumber: emp?.tableNumber || null,
        tableImage: emp?.tableImage || null,
        createdAt: reg.createdAt,
        token: reg.token,
        walkIns: walkIns.map((w) => ({
          scannedAt: w.scannedAt,
          scannedBy: w.scannedBy,
        })),
      };
    })
  );

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

// PERMANENT DELETE registration (cascade walk-ins)
exports.permanentDeleteRegistration = asyncHandler(async (req, res) => {
  const reg = await Registration.findOneDeleted({ _id: req.params.id });
  if (!reg) return response(res, 404, "Registration not found in trash");

  // Delete walk-ins linked to this registration
  await WalkIn.deleteMany({ registrationId: reg._id });

  await reg.deleteOne();
  return response(res, 200, "Registration and walk-ins permanently deleted");
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

// PERMANENT DELETE ALL (cascade walk-ins)
exports.permanentDeleteAllRegistrations = asyncHandler(async (req, res) => {
  const regs = await Registration.findDeleted();
  if (!regs.length)
    return response(res, 404, "No registrations found in trash to delete");

  const regIds = regs.map((r) => r._id);

  // Delete walk-ins linked to all trashed registrations
  await WalkIn.deleteMany({ registrationId: { $in: regIds } });

  await Registration.deleteManyDeleted();

  return response(res, 200, `Permanently deleted ${regs.length} registrations and their walk-ins`);
});

