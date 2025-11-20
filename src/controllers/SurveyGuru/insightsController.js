const mongoose = require("mongoose");
const asyncHandler = require("../../middlewares/asyncHandler");
const SurveyForm = require("../../models/SurveyForm");
const SurveyResponse = require("../../models/SurveyResponse");
const SurveyRecipient = require("../../models/SurveyRecipient");
const response = require("../../utils/response");

// Get question distribution for pie charts (multi, rating, nps questions)
exports.getQuestionDistribution = asyncHandler(async (req, res) => {
    const { slug } = req.params;
    const { questionId, topN } = req.query;

    if (!questionId) return response(res, 400, "Question ID is required");

    const form = await SurveyForm.findOne({ slug }).notDeleted().lean();
    if (!form) return response(res, 404, "Form not found");

    const question = form.questions?.find(q => String(q._id) === questionId);
    if (!question) return response(res, 404, "Question not found");

    if (question.type === "text") {
        return response(res, 400, "Text questions are not supported for insights");
    }

    const topLimit = topN ? parseInt(topN) : null;

    let pipeline = [];

    if (question.type === "multi") {
        pipeline = [
            {
                $match: {
                    formId: form._id,
                    deletedAt: { $exists: false },
                    "answers.questionId": new mongoose.Types.ObjectId(questionId)
                }
            },
            {
                $unwind: "$answers"
            },
            {
                $match: {
                    "answers.questionId": new mongoose.Types.ObjectId(questionId),
                    "answers.optionIds": { $exists: true, $ne: [] }
                }
            },
            {
                $unwind: "$answers.optionIds"
            },
            {
                $group: {
                    _id: "$answers.optionIds",
                    count: { $sum: 1 }
                }
            },
            { $sort: { count: -1 } }
        ];

        if (topLimit && topLimit > 0) {
            pipeline.push({ $limit: topLimit });
        }

        const distribution = await SurveyResponse.aggregate(pipeline);

        const optionMap = new Map();
        (question.options || []).forEach(opt => {
            optionMap.set(String(opt._id), opt.label || "Unknown");
        });

        const chartData = distribution.map(item => ({
            label: optionMap.get(String(item._id)) || "Unknown Option",
            value: item.count,
            optionId: String(item._id)
        }));

        return response(res, 200, "Question distribution fetched", {
            questionId,
            questionLabel: question.label,
            questionType: question.type,
            data: chartData,
            total: chartData.reduce((sum, d) => sum + d.value, 0)
        });
    } else if (question.type === "rating" || question.type === "nps") {
        pipeline = [
            {
                $match: {
                    formId: form._id,
                    deletedAt: { $exists: false },
                    "answers.questionId": new mongoose.Types.ObjectId(questionId)
                }
            },
            {
                $unwind: "$answers"
            },
            {
                $match: {
                    "answers.questionId": new mongoose.Types.ObjectId(questionId),
                    "answers.number": { $exists: true, $ne: null }
                }
            },
            {
                $group: {
                    _id: "$answers.number",
                    count: { $sum: 1 }
                }
            },
            { $sort: { _id: 1 } }
        ];

        const distribution = await SurveyResponse.aggregate(pipeline);

        const chartData = distribution.map(item => ({
            label: String(item._id),
            value: item.count
        }));

        return response(res, 200, "Question distribution fetched", {
            questionId,
            questionLabel: question.label,
            questionType: question.type,
            data: chartData,
            total: chartData.reduce((sum, d) => sum + d.value, 0)
        });
    } else {
        return response(res, 400, "Unsupported question type for insights");
    }
});

// Get time-based distribution for line charts
exports.getTimeDistribution = asyncHandler(async (req, res) => {
    const { slug } = req.params;
    const { startDate, endDate, intervalMinutes } = req.query;

    if (!startDate || !endDate) {
        return response(res, 400, "startDate and endDate are required");
    }

    const form = await SurveyForm.findOne({ slug }).notDeleted().lean();
    if (!form) return response(res, 404, "Form not found");

    const start = new Date(startDate);
    const end = new Date(endDate);
    const interval = parseInt(intervalMinutes) || 60;

    if (isNaN(start.getTime()) || isNaN(end.getTime())) {
        return response(res, 400, "Invalid date format");
    }

    const intervalMs = interval * 60 * 1000;

    const pipeline = [
        {
            $match: {
                formId: form._id,
                deletedAt: { $exists: false },
                submittedAt: { $gte: start, $lte: end }
            }
        },
        {
            $project: {
                submittedAt: 1,
                bucketIndex: {
                    $floor: {
                        $divide: [
                            { $subtract: ["$submittedAt", start] },
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

    const timeDistribution = await SurveyResponse.aggregate(pipeline);

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
        fieldName: "submittedAt",
        intervalMinutes: interval,
        data: filledData,
        total
    });
});

// Get available questions for insights (excluding text type)
exports.getAvailableQuestions = asyncHandler(async (req, res) => {
    const { slug } = req.params;

    const form = await SurveyForm.findOne({ slug }).notDeleted().lean();
    if (!form) return response(res, 404, "Form not found");

    const categoricalFields = [];
    const timeFields = [
        { name: "submittedAt", label: "Submitted At", type: "time" }
    ];

    if (form.questions?.length) {
        form.questions.forEach((q, idx) => {
            if (q.type === "text") {
                return;
            }

            if (q.type === "multi") {
                categoricalFields.push({
                    name: String(q._id),
                    label: q.label || `Question ${idx + 1}`,
                    type: "multi",
                    allowTopN: true,
                    questionType: "multi",
                    options: (q.options || []).map(opt => ({
                        id: String(opt._id),
                        label: opt.label
                    }))
                });
            } else if (q.type === "rating" || q.type === "nps") {
                categoricalFields.push({
                    name: String(q._id),
                    label: q.label || `Question ${idx + 1}`,
                    type: q.type,
                    allowTopN: false,
                    questionType: q.type,
                    scale: q.scale || { min: 1, max: 5, step: 1 }
                });
            }
        });
    }

    return response(res, 200, "Available questions fetched", {
        categoricalFields,
        timeFields
    });
});

// Get summary statistics
exports.getInsightsSummary = asyncHandler(async (req, res) => {
    const { slug } = req.params;

    const form = await SurveyForm.findOne({ slug }).notDeleted().lean();
    if (!form) return response(res, 404, "Form not found");

    const totalResponses = await SurveyResponse.countDocuments({
        formId: form._id,
        deletedAt: { $exists: false }
    });

    let totalRecipients = 0;
    let respondedRecipients = 0;

    if (!form.isAnonymous) {
        totalRecipients = await SurveyRecipient.countDocuments({
            formId: form._id,
            deletedAt: { $exists: false }
        });

        respondedRecipients = await SurveyRecipient.countDocuments({
            formId: form._id,
            status: "responded",
            deletedAt: { $exists: false }
        });
    }

    const responseRate = totalRecipients > 0
        ? ((respondedRecipients / totalRecipients) * 100).toFixed(2)
        : null;

    return response(res, 200, "Insights summary fetched", {
        totalResponses,
        totalRecipients: form.isAnonymous ? null : totalRecipients,
        respondedRecipients: form.isAnonymous ? null : respondedRecipients,
        responseRate: form.isAnonymous ? null : responseRate,
        isAnonymous: form.isAnonymous
    });
});

