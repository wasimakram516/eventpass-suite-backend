const mongoose = require("mongoose");
const asyncHandler = require("../../middlewares/asyncHandler");
const Event = require("../../models/Event");
const Registration = require("../../models/Registration");
const WalkIn = require("../../models/WalkIn");
const DigiPassParticipationLog = require("../../models/DigiPassParticipationLog");
const response = require("../../utils/response");

// Get field distribution for pie charts (categorical fields)
exports.getFieldDistribution = asyncHandler(async (req, res) => {
    const { slug } = req.params;
    const { fieldName, topN, mode } = req.query;

    if (!fieldName) return response(res, 400, "Field name is required");

    const event = await Event.findOne({ slug }).lean();
    if (!event) return response(res, 404, "Event not found");

    let formFields = event.formFields || [];
    if (event.linkedEventRegId) {
        const linkedEvent = await Event.findById(event.linkedEventRegId).lean();
        if (linkedEvent) {
            formFields = linkedEvent.formFields || [];
        }
    }

    const topLimit = topN ? parseInt(topN) : null;
    const isCustomField = formFields?.some(f => f.inputName === fieldName);

    let pipeline = [];
    
    if (event.linkedEventRegId) {
        pipeline = [
            { $match: { digipassEventId: event._id } },
            {
                $lookup: {
                    from: "registrations",
                    localField: "eventRegRegistrationId",
                    foreignField: "_id",
                    as: "reg"
                }
            },
            { $unwind: "$reg" },
            { $match: { "reg.deletedAt": { $exists: false } } }
        ];

        let groupId;
        if (fieldName === 'tasksCompleted') {
            groupId = `$reg.tasksCompleted`;
        } else if (isCustomField) {
            pipeline.push({
                $match: {
                    [`reg.customFields.${fieldName}`]: { $exists: true, $ne: null, $ne: "" }
                }
            });
            groupId = `$reg.customFields.${fieldName}`;
        } else {
            pipeline.push({
                $match: {
                    $or: [
                        { "reg.customFields": { $exists: false } },
                        { "reg.customFields": {} }
                    ],
                    [`reg.${fieldName}`]: { $exists: true, $ne: null, $ne: "" }
                }
            });
            groupId = `$reg.${fieldName}`;
        }

        const sumValue = mode === "completions" ? "$reg.tasksCompleted" : 1;
        pipeline.push(
            { $group: { _id: groupId, count: { $sum: sumValue } } },
            { $sort: { count: -1 } }
        );

    } else {
        pipeline = [
            { $match: { eventId: event._id, deletedAt: { $exists: false } } }
        ];

        let groupId;
        if (fieldName === 'tasksCompleted') {
            groupId = `$tasksCompleted`;
        } else if (isCustomField) {
            pipeline.push({
                $match: {
                    [`customFields.${fieldName}`]: { $exists: true, $ne: null, $ne: "" }
                }
            });
            groupId = `$customFields.${fieldName}`;
        } else {
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

        const sumValue = mode === "completions" ? "$tasksCompleted" : 1;
        pipeline.push(
            { $group: { _id: groupId, count: { $sum: sumValue } } },
            { $sort: { count: -1 } }
        );
    }

    if (topLimit && topLimit > 0) {
        pipeline.push({ $limit: topLimit });
    }

    let distribution;
    if (event.linkedEventRegId) {
        distribution = await DigiPassParticipationLog.aggregate(pipeline);
    } else {
        distribution = await Registration.aggregate(pipeline);
    }

    const chartData = distribution.map(item => ({
        label: fieldName === 'tasksCompleted' && mode !== 'completions' ? `${item._id} Task(s)` : String(item._id || "Unknown"),
        value: item.count
    }));

    return response(res, 200, mode === "completions" ? "Completions breakdown fetched" : "Field distribution fetched", {
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

    const event = await Event.findOne({ slug }).lean();
    if (!event) return response(res, 404, "Event not found");

    const start = new Date(startDate);
    const end = new Date(endDate);
    const interval = parseInt(intervalMinutes) || 60;

    if (isNaN(start.getTime()) || isNaN(end.getTime())) {
        return response(res, 400, "Invalid date format");
    }

    const intervalMs = interval * 60 * 1000;

    let pipeline = [];
    let aggregateModel;

    if (fieldName === "createdAt" || fieldName === "registeredAt") {
        if (event.linkedEventRegId) {
            aggregateModel = DigiPassParticipationLog;
            pipeline = [
                {
                    $match: {
                        digipassEventId: event._id,
                        createdAt: { $gte: start, $lte: end }
                    }
                }
            ];
        } else {
            aggregateModel = Registration;
            pipeline = [
                {
                    $match: {
                        eventId: event._id,
                        deletedAt: { $exists: false },
                        createdAt: { $gte: start, $lte: end }
                    }
                }
            ];
        }

        pipeline.push(
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
        );

    } else if (fieldName === "scannedAt") {
        aggregateModel = WalkIn;
        pipeline = [
            {
                $match: {
                    eventId: event._id,
                    deletedAt: { $exists: false },
                    scannedAt: { $gte: start, $lte: end }
                }
            },
            {
                $project: {
                    scannedAt: 1,
                    bucketIndex: {
                        $floor: {
                            $divide: [
                                { $subtract: ["$scannedAt", start] },
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

    const timeDistribution = await aggregateModel.aggregate(pipeline);

    const dataMap = new Map(timeDistribution.map(d => [d._id, d.count]));

    const filledData = [];
    let total = 0;
    let bucketIndex = 0;

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

    const event = await Event.findOne({ slug }).lean();
    if (!event) return response(res, 404, "Event not found");

    let formFields = event.formFields || [];
    if (event.linkedEventRegId) {
        const linkedEvent = await Event.findById(event.linkedEventRegId).lean();
        if (linkedEvent) {
            formFields = linkedEvent.formFields || [];
        }
    }

    const categoricalFields = [];
    const timeFields = [
        { name: "createdAt", label: "Signed In At", type: "time" },
        { name: "scannedAt", label: "Scanned At", type: "time" }
    ];
    const specialFields = [
        { name: "scannedBy", label: "Scanned By", type: "special", requiresLookup: true },
        { name: "activitiesPerParticipant", label: "Activities Completed per Participant", type: "special", chartType: "bar" }
    ];

    if (formFields.length) {
        formFields.forEach(f => {
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

    // Add Digipass specific fields
    categoricalFields.push({
        name: "tasksCompleted",
        label: "Tasks Completed",
        type: "number",
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

    const event = await Event.findOne({ slug }).lean();
    if (!event) return response(res, 404, "Event not found");

    // Total participants joined this DigiPass event
    let totalParticipants;
    if (event.linkedEventRegId) {
        totalParticipants = await DigiPassParticipationLog.countDocuments({ 
            digipassEventId: event._id 
        });
    } else {
        totalParticipants = await Registration.countDocuments({
            eventId: event._id
        });
    }

    // Total activity completions (every scan is a completion)
    const totalActivityCompletions = await WalkIn.countDocuments({
        eventId: event._id
    });

    // Average activities per participant
    const avgActivitiesPerParticipant = totalParticipants > 0 
        ? (totalActivityCompletions / totalParticipants).toFixed(2) 
        : 0;

    let scanRate = 0;
    let totalLinkedRegistrations = 0;
    if (event.linkedEventRegId) {
        totalLinkedRegistrations = await Registration.countDocuments({
            eventId: event.linkedEventRegId,
            deletedAt: { $exists: false }
        });
        scanRate = totalLinkedRegistrations > 0 
            ? ((totalParticipants / totalLinkedRegistrations) * 100).toFixed(2)
            : 0;
    }

    return response(res, 200, "Insights summary fetched", {
        totalParticipants,
        totalActivityCompletions,
        avgActivitiesPerParticipant: Number(avgActivitiesPerParticipant),
        scanRate: Number(scanRate),
        totalRegistrations: totalParticipants // backward compatibility
    });
});

// Get scanned-by distribution (Desk / Door)
exports.getScannedByTypeDistribution = asyncHandler(async (req, res) => {
    const { slug } = req.params;

    const event = await Event.findOne({ slug }).lean();
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

    const event = await Event.findOne({ slug }).lean();
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

// Get activities per participant distribution
exports.getActivitiesPerParticipantDistribution = asyncHandler(async (req, res) => {
    const { slug } = req.params;

    const event = await Event.findOne({ slug }).lean();
    if (!event) return response(res, 404, "Event not found");

    const pipeline = [
        { $match: { eventId: event._id, deletedAt: { $exists: false } } },
        {
            $group: {
                _id: "$registrationId",
                count: { $sum: 1 }
            }
        },
        {
            $group: {
                _id: "$count",
                participantCount: { $sum: 1 }
            }
        },
        { $sort: { _id: 1 } }
    ];

    const distribution = await WalkIn.aggregate(pipeline);

    const chartData = distribution.map(item => ({
        label: `${item._id} ${item._id === 1 ? 'Activity' : 'Activities'}`,
        value: item.participantCount,
        completionCount: item._id,
        participantCount: item.participantCount
    }));

    return response(res, 200, "Activities per participant distribution fetched", {
        data: chartData,
        total: chartData.reduce((sum, d) => sum + d.value, 0)
    });
});
