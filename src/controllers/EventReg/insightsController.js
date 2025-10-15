const mongoose = require("mongoose");
const asyncHandler = require("../../middlewares/asyncHandler");
const Event = require("../../models/Event");
const Registration = require("../../models/Registration");
const WalkIn = require("../../models/WalkIn");
const response = require("../../utils/response");

// Get field distribution for pie charts (categorical fields)
exports.getFieldDistribution = asyncHandler(async (req, res) => {
    const { slug } = req.params;
    const { fieldName, topN } = req.query;

    if (!fieldName) return response(res, 400, "Field name is required");

    const event = await Event.findOne({ slug }).notDeleted().lean();
    if (!event) return response(res, 404, "Event not found");

    const topLimit = topN ? parseInt(topN) : null;

    const isCustomField = event.formFields?.some(f => f.inputName === fieldName);

    const pipeline = [
        { $match: { eventId: event._id, deletedAt: { $exists: false } } }
    ];

    let groupId;
    if (isCustomField) {
        // For custom fields
        pipeline.push({
            $match: {
                [`customFields.${fieldName}`]: { $exists: true, $ne: null, $ne: "" }
            }
        });
        groupId = `$customFields.${fieldName}`;
    } else {
        // For classic fields
        pipeline.push({
            $match: {
                $or: [
                    { customFields: { $exists: false } },
                    { customFields: {} }
                ],
                [fieldName]: { $exists: true, $ne: null, $ne: "" }
            }
        });
        groupId = `$${fieldName}`;
    }

    pipeline.push(
        {
            $group: {
                _id: groupId,
                count: { $sum: 1 }
            }
        },
        { $sort: { count: -1 } }
    );

    if (topLimit && topLimit > 0) {
        pipeline.push({ $limit: topLimit });
    }

    const distribution = await Registration.aggregate(pipeline);

    const chartData = distribution.map(item => ({
        label: String(item._id || "Unknown"),
        value: item.count
    }));

    return response(res, 200, "Field distribution fetched", {
        fieldName,
        data: chartData,
        total: chartData.reduce((sum, d) => sum + d.value, 0)
    });
});

// Get time-based distribution for line charts
exports.getTimeDistribution = asyncHandler(async (req, res) => {
    const { slug } = req.params;
    const { fieldName, startDate, endDate, intervalMinutes } = req.query;

    if (!fieldName || !startDate || !endDate) {
        return response(res, 400, "fieldName, startDate, and endDate are required");
    }

    const event = await Event.findOne({ slug }).notDeleted().lean();
    if (!event) return response(res, 404, "Event not found");

    const start = new Date(startDate);
    const end = new Date(endDate);
    const interval = parseInt(intervalMinutes) || 60;

    if (isNaN(start.getTime()) || isNaN(end.getTime())) {
        return response(res, 400, "Invalid date format");
    }

    const intervalMs = interval * 60 * 1000;

    let pipeline = [];

    if (fieldName === "createdAt" || fieldName === "registeredAt") {
        pipeline = [
            {
                $match: {
                    eventId: event._id,
                    deletedAt: { $exists: false },
                    createdAt: { $gte: start, $lte: end }
                }
            },
            {
                $project: {
                    createdAt: 1,
                    bucketIndex: {
                        $floor: {
                            $divide: [
                                { $subtract: ["$createdAt", start] },
                                intervalMs
                            ]
                        }
                    }
                }
            },
            {
                $group: {
                    _id: "$bucketIndex",
                    count: { $sum: 1 }
                }
            },
            { $sort: { _id: 1 } }
        ];
    } else if (fieldName === "scannedAt") {
        pipeline = [
            {
                $match: {
                    eventId: event._id,
                    deletedAt: { $exists: false }
                }
            },
            {
                $lookup: {
                    from: "walkins",
                    localField: "_id",
                    foreignField: "registrationId",
                    as: "walkIns"
                }
            },
            { $unwind: "$walkIns" },
            {
                $match: {
                    "walkIns.scannedAt": { $gte: start, $lte: end }
                }
            },
            {
                $project: {
                    scannedAt: "$walkIns.scannedAt",
                    bucketIndex: {
                        $floor: {
                            $divide: [
                                { $subtract: ["$walkIns.scannedAt", start] },
                                intervalMs
                            ]
                        }
                    }
                }
            },
            {
                $group: {
                    _id: "$bucketIndex",
                    count: { $sum: 1 }
                }
            },
            { $sort: { _id: 1 } }
        ];
    } else {
        return response(res, 400, "Invalid time field. Use: createdAt, registeredAt, or scannedAt");
    }

    const timeDistribution = await Registration.aggregate(pipeline);

    const dataMap = new Map(timeDistribution.map(d => [d._id, d.count]));

    const filledData = [];
    let total = 0;
    let bucketIndex = 0;

    // Generate intervals from start to end with exact user-specified boundaries
    for (let t = start.getTime(); t < end.getTime(); t += intervalMs) {
        const count = dataMap.get(bucketIndex) || 0;
        total += count;

        filledData.push({
            timestamp: new Date(t).toISOString(),
            count
        });

        bucketIndex++;
    }

    return response(res, 200, "Time distribution fetched", {
        fieldName,
        intervalMinutes: interval,
        data: filledData,
        total
    });


});

// Get available fields for insights
exports.getAvailableFields = asyncHandler(async (req, res) => {
    const { slug } = req.params;

    const event = await Event.findOne({ slug }).notDeleted().lean();
    if (!event) return response(res, 404, "Event not found");

    const categoricalFields = [];
    const timeFields = [
        { name: "createdAt", label: "Registered At", type: "time" },
        { name: "scannedAt", label: "Scanned At", type: "time" }
    ];
    const specialFields = [
        { name: "scannedBy", label: "Scanned By", type: "special", requiresLookup: true }
    ];

    if (event.formFields?.length) {
        event.formFields.forEach(f => {
            if (f.inputType === "text" || f.inputType === "number") {
                categoricalFields.push({
                    name: f.inputName,
                    label: f.inputName,
                    type: f.inputType,
                    allowTopN: true
                });
            } else if (f.inputType === "radio" || f.inputType === "list") {
                categoricalFields.push({
                    name: f.inputName,
                    label: f.inputName,
                    type: f.inputType,
                    allowTopN: false,
                    values: f.values || []
                });
            }
        });
    } else {
        categoricalFields.push(
            { name: "fullName", label: "Full Name", type: "text", allowTopN: true },
            { name: "email", label: "Email", type: "text", allowTopN: true },
            { name: "phone", label: "Phone", type: "text", allowTopN: true },
            { name: "company", label: "Company", type: "text", allowTopN: true }
        );
    }

    categoricalFields.push({
        name: "token",
        label: "Token",
        type: "text",
        allowTopN: true
    });

    return response(res, 200, "Available fields fetched", {
        categoricalFields,
        timeFields,
        specialFields
    });
});

// Get summary statistics
exports.getInsightsSummary = asyncHandler(async (req, res) => {
    const { slug } = req.params;

    const event = await Event.findOne({ slug }).notDeleted().lean();
    if (!event) return response(res, 404, "Event not found");

    const totalRegistrations = await Registration.countDocuments({
        eventId: event._id,
        deletedAt: { $exists: false }
    });

    const totalScans = await WalkIn.countDocuments({
        eventId: event._id
    });

    const uniqueScannedRegs = await WalkIn.distinct("registrationId", {
        eventId: event._id
    });

    return response(res, 200, "Insights summary fetched", {
        totalRegistrations,
        totalScans,
        uniqueScanned: uniqueScannedRegs.length,
        scanRate: totalRegistrations > 0
            ? ((uniqueScannedRegs.length / totalRegistrations) * 100).toFixed(2)
            : 0
    });
});


// Get scanned-by distribution (Desk / Door)
exports.getScannedByTypeDistribution = asyncHandler(async (req, res) => {
    const { slug } = req.params;

    const event = await Event.findOne({ slug }).notDeleted().lean();
    if (!event) return response(res, 404, "Event not found");

    const totalWalkIns = await WalkIn.countDocuments({ eventId: event._id });

    if (totalWalkIns === 0) {
        return response(res, 200, "No walk-in records found for this event", {
            data: [],
            total: 0
        });
    }

    const pipeline = [
        { $match: { eventId: event._id } },
        {
            $lookup: {
                from: "users",
                localField: "scannedBy",
                foreignField: "_id",
                as: "staffUser"
            }
        },
        { $unwind: { path: "$staffUser", preserveNullAndEmptyArrays: true } },
        {
            $group: {
                _id: "$staffUser.staffType",
                count: { $sum: 1 }
            }
        },
        { $sort: { count: -1 } }
    ];

    const distribution = await WalkIn.aggregate(pipeline);

    const chartData = distribution
        .filter(item => item._id)
        .map(item => ({
            label: item._id.charAt(0).toUpperCase() + item._id.slice(1),
            value: item.count,
            type: item._id
        }));

    return response(res, 200, "Scanned-by type distribution fetched", {
        data: chartData,
        total: chartData.reduce((sum, d) => sum + d.value, 0)
    });
});

// Get scanned-by user distribution (Individual users by stafftype)
exports.getScannedByUserDistribution = asyncHandler(async (req, res) => {
    const { slug } = req.params;
    const { staffType } = req.query;

    const event = await Event.findOne({ slug }).notDeleted().lean();
    if (!event) return response(res, 404, "Event not found");

    const pipeline = [
        { $match: { eventId: event._id } },
        {
            $lookup: {
                from: "users",
                localField: "scannedBy",
                foreignField: "_id",
                as: "staffUser"
            }
        },
        { $unwind: { path: "$staffUser", preserveNullAndEmptyArrays: true } }
    ];

    if (staffType) {
        pipeline.push({
            $match: { "staffUser.staffType": staffType }
        });
    }

    pipeline.push(
        {
            $group: {
                _id: "$scannedBy",
                userName: { $first: "$staffUser.name" },
                userEmail: { $first: "$staffUser.email" },
                staffType: { $first: "$staffUser.staffType" },
                count: { $sum: 1 }
            }
        },
        { $sort: { count: -1 } }
    );

    const distribution = await WalkIn.aggregate(pipeline);

    if (!distribution.length) {
        return response(res, 200, staffType ? `No ${staffType} users found` : "No users found", {
            staffType: staffType || "all",
            data: [],
            total: 0
        });
    }

    const chartData = distribution.map(item => ({
        label: item.userName || item.userEmail || "Unknown User",
        value: item.count,
        userId: item._id,
        email: item.userEmail,
        staffType: item.staffType
    }));

    return response(res, 200, staffType
        ? `Scanned-by ${staffType} users distribution fetched`
        : "Scanned-by all users distribution fetched", {
        staffType: staffType || "all",
        data: chartData,
        total: chartData.reduce((sum, d) => sum + d.value, 0)
    });
});