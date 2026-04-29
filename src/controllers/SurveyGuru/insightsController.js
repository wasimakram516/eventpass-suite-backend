const mongoose = require("mongoose");
const asyncHandler = require("../../middlewares/asyncHandler");
const SurveyForm = require("../../models/SurveyForm");
const SurveyResponse = require("../../models/SurveyResponse");
const SurveyRecipient = require("../../models/SurveyRecipient");
const response = require("../../utils/response");
const customFieldUtils = require("../../utils/customFieldUtils");
const Event = require("../../models/Event");
const Registration = require("../../models/Registration");

// Get question distribution for pie charts (multi, rating, nps questions)
exports.getQuestionDistribution = asyncHandler(async (req, res) => {
    const { slug } = req.params;
    const { questionId, isRegistrationField: rawIsReg } = req.query;
    const isRegistrationField = rawIsReg === "true";

    if (!questionId) return response(res, 400, "questionId is required");

    const form = await SurveyForm.findOne({ slug }).lean();
    if (!form) return response(res, 404, "Form not found");

    let question = isRegistrationField 
        ? { label: questionId, type: "multi" }
        : form.questions?.find(q => String(q._id) === questionId);
    
    if (!question) return response(res, 404, "Question or Field not found");

    if (isRegistrationField) {
            const responses = await SurveyResponse.find({
                formId: form._id,
                deletedAt: { $exists: false }
            }).lean();

            if (!responses.length) {
                return response(res, 200, "No responses found", { questionId, data: [], total: 0 });
            }

            const recipients = await SurveyRecipient.find({ formId: form._id }).lean();
            const recipientIdMap = new Map();
            const recipientEmailMap = new Map();

            recipients.forEach(rec => {
                recipientIdMap.set(String(rec._id), rec);
                if (rec.email) recipientEmailMap.set(rec.email.toLowerCase().trim(), rec);
            });

            const tokens = new Set();
            responses.forEach(r => {
                let recipient = null;
                if (r.recipientId) {
                    recipient = recipientIdMap.get(String(r.recipientId));
                } else if (r.attendee?.email) {
                    recipient = recipientEmailMap.get(r.attendee.email.toLowerCase().trim());
                }

                if (recipient && recipient.token) {
                    tokens.add(recipient.token);
                } else if (r.attendee?.email) {
                    tokens.add(r.attendee.email.toLowerCase().trim());
                }
            });

        const registrations = await Registration.find({
            eventId: form.eventId,
            $or: [
                { token: { $in: Array.from(tokens) } },
                { email: { $in: Array.from(tokens).filter(t => t.includes("@")) } }
            ],
            deletedAt: { $exists: false }
        }).lean();

        const distributionMap = new Map();

        registrations.forEach(reg => {
            let val = null;
            const fieldName = questionId;
            const fn = String(fieldName).toLowerCase().replace(/\s/g, "");

            if (fn === "company") val = customFieldUtils.pickCompany(reg);
            else if (fn === "fullname" || fn === "name") val = customFieldUtils.pickFullName(reg);
            else if (fn === "email") val = customFieldUtils.pickEmail(reg);
            else if (fn === "phone") val = customFieldUtils.pickPhone(reg);
            else if (fn === "department") val = customFieldUtils.pickDepartment(reg);
            else if (fn === "registrationtype") val = customFieldUtils.pickRegistrationType(reg);
            else if (fn === "wing") val = customFieldUtils.pickWing(reg);
            else if (fn === "title") val = customFieldUtils.pickTitle(reg);
            else {
                val = customFieldUtils.pick(reg, fieldName);
            }

            val = val || "Unknown";
            distributionMap.set(val, (distributionMap.get(val) || 0) + 1);
        });
        const chartData = Array.from(distributionMap.entries()).map(([label, value]) => ({
            label, value
        })).sort((a, b) => b.value - a.value);

        return response(res, 200, "Field distribution fetched", {
            questionId,
            questionLabel: question.label || questionId,
            questionType: "multi",
            data: chartData,
            total: chartData.reduce((sum, d) => sum + d.value, 0)
        });
    }

    if (question.type === "multi") {
        const pipeline = [
            {
                $match: {
                    formId: form._id,
                    deletedAt: { $exists: false },
                    "answers.questionId": new mongoose.Types.ObjectId(questionId)
                }
            },
            { $unwind: "$answers" },
            {
                $match: {
                    "answers.questionId": new mongoose.Types.ObjectId(questionId),
                    "answers.optionIds": { $exists: true, $ne: [] }
                }
            },
            { $unwind: "$answers.optionIds" },
            {
                $group: {
                    _id: "$answers.optionIds",
                    count: { $sum: 1 }
                }
            },
            { $sort: { count: -1 } }
        ];

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
        const pipeline = [
            {
                $match: {
                    formId: form._id,
                    deletedAt: { $exists: false },
                    "answers.questionId": new mongoose.Types.ObjectId(questionId)
                }
            },
            { $unwind: "$answers" },
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

    const form = await SurveyForm.findOne({ slug }).lean();
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

// Get available fields/questions for filtering and charts
exports.getAvailableQuestions = asyncHandler(async (req, res) => {
    const { slug } = req.params;

    const form = await SurveyForm.findOne({ slug }).lean();
    if (!form) return response(res, 404, "Form not found");

    const FIELD_COLOR = "#0077b6";

    // Survey Questions (Categorical & Text)
    const questions = (form.questions || [])
        .map((q) => ({
            name: String(q._id),
            label: q.label,
            type: q.type,
            color: FIELD_COLOR,
            isRegistrationField: false,
            isSurveyQuestion: true // This ensures they are counted in KPIs
        }));

    // Time Fields
    const timeFields = [
        { name: "submittedAt", label: "Submitted At", type: "time" }
    ];

    // Registration Fields (Dynamic from Event)
    let registrationFields = [
        { name: "fullName", label: "Full Name", type: "text", isRegistrationField: true, isStandalone: true, color: FIELD_COLOR },
        { name: "email", label: "Email Address", type: "text", isRegistrationField: true, isStandalone: true, color: FIELD_COLOR },
        { name: "company", label: "Company", type: "text", isRegistrationField: true, isStandalone: true, color: FIELD_COLOR },
        { name: "phone", label: "Phone Number", type: "text", isRegistrationField: true, isStandalone: true, color: FIELD_COLOR },
    ];

    const normalizeKey = (s) => String(s || "").toLowerCase().trim().replace(/[^a-z0-9]/g, "");

    if (form.eventId) {
        const event = await Event.findById(form.eventId).lean();
        if (event && event.formFields && Array.isArray(event.formFields) && event.formFields.length > 0) {
            // IF custom fields are enabled/present, we ONLY use those to avoid clutter
            const eventCustomFields = [];
            event.formFields.forEach(field => {
                eventCustomFields.push({
                    name: field.inputName,
                    label: field.label || field.inputName,
                    type: field.inputType === "number" ? "number" : "text",
                    isRegistrationField: true,
                    isStandalone: true,
                    color: FIELD_COLOR
                });
            });
            registrationFields = eventCustomFields;
        }
    }

    const addedNormalized = new Set(registrationFields.map(f => normalizeKey(f.name)));

    const categoricalFields = [
        ...questions.filter(q => q.type !== "text"),
        ...(form.isAnonymous ? [] : registrationFields.filter(f => f.isStandalone))
    ];

    return response(res, 200, "Available questions fetched", {
        totalQuestions: questions.length, // Include total count in metadata
        categoricalFields,
        timeFields,
        registrationFields: form.isAnonymous ? [] : registrationFields
    });
});

// Get segmented distribution for grouped bar charts
exports.getSegmentedDistribution = asyncHandler(async (req, res) => {
    const { slug } = req.params;
    const { questionId, fieldName } = req.query;

    if (!questionId || !fieldName) {
        return response(res, 400, "questionId and fieldName are required");
    }

    const form = await SurveyForm.findOne({ slug }).lean();
    if (!form) return response(res, 404, "Form not found");

    const question = form.questions?.find(q => String(q._id) === questionId);
    if (!question) return response(res, 404, "Question not found");

    const responses = await SurveyResponse.find({
        formId: form._id,
        deletedAt: { $exists: false },
        "answers.questionId": new mongoose.Types.ObjectId(questionId)
    }).lean();

    if (!responses.length) {
        return response(res, 200, "No responses found", { questionId, fieldName, type: question.type, data: [] });
    }

    const recipients = await SurveyRecipient.find({ formId: form._id }).lean();
    const recipientIdMap = new Map();
    const recipientEmailMap = new Map();
    
    recipients.forEach(rec => {
        recipientIdMap.set(String(rec._id), rec);
        if (rec.email) recipientEmailMap.set(String(rec.email).toLowerCase().trim(), rec);
    });

    const tokens = new Set();
    const responseToTokenMap = new Map();

    responses.forEach(r => {
        let recipient = null;
        if (r.recipientId) {
            recipient = recipientIdMap.get(String(r.recipientId));
        } else if (r.attendee?.email) {
            recipient = recipientEmailMap.get(String(r.attendee.email).toLowerCase().trim());
        }

        if (recipient && recipient.token) {
            tokens.add(String(recipient.token));
            responseToTokenMap.set(String(r._id), String(recipient.token));
        } else if (r.attendee?.email) {
            const email = String(r.attendee.email).toLowerCase().trim();
            tokens.add(email);
            responseToTokenMap.set(String(r._id), email);
        }
    });

    if (tokens.size === 0) {
        return response(res, 200, "No matching registrants found for these responses", {
            questionId, fieldName, type: question.type, data: []
        });
    }

    const allTokens = Array.from(tokens);
    const registrations = await Registration.find({
        eventId: form.eventId,
        $or: [
            { token: { $in: allTokens } },
            { email: { $in: allTokens.filter(t => t.includes("@")) } },
            { email: { $in: responses.map(r => String(r.attendee?.email || "").toLowerCase().trim()).filter(Boolean) } }
        ],
        deletedAt: { $exists: false }
    }).lean();

    const regMap = new Map();
    const regEmailMap = new Map();

    registrations.forEach(reg => {
        if (reg.token) regMap.set(String(reg.token), reg);
        if (reg.email) regEmailMap.set(String(reg.email).toLowerCase().trim(), reg);
    });

    const optionMap = new Map();
    if (question.type === "multi") {
        (question.options || []).forEach(opt => {
            optionMap.set(String(opt._id), opt.label || "Unknown");
        });
    }

    const segmentsMap = new Map();

    responses.forEach(r => {
        const tokenOrEmail = responseToTokenMap.get(String(r._id));
        let registration = null;
        
        if (tokenOrEmail) {
            const lookUpKey = String(tokenOrEmail).toLowerCase().trim();
            registration = regMap.get(tokenOrEmail) || regMap.get(lookUpKey) || regEmailMap.get(lookUpKey);
        }
        
        if (!registration && r.attendee?.email) {
            registration = regEmailMap.get(String(r.attendee.email).toLowerCase().trim());
        }

        if (!registration) return;

        let segmentValue = customFieldUtils.pick(registration, fieldName);

        segmentValue = segmentValue ? String(segmentValue).trim() : "Unknown";

        if (!segmentsMap.has(segmentValue)) {
            segmentsMap.set(segmentValue, { segment: segmentValue, distribution: new Map(), total: 0, sum: 0 });
        }

        const segData = segmentsMap.get(segmentValue);
        const ans = (r.answers || []).find(a => String(a.questionId) === questionId);
        if (!ans) return;

        if (question.type === "multi") {
            (ans.optionIds || []).forEach(oid => {
                const label = optionMap.get(String(oid)) || "Unknown";
                segData.distribution.set(label, (segData.distribution.get(label) || 0) + 1);
                segData.total++;
            });
        } else {
            const val = ans.number;
            if (val !== null && val !== undefined) {
                const label = String(val);
                segData.distribution.set(label, (segData.distribution.get(label) || 0) + 1);
                segData.total++;
                segData.sum += val;
            }
        }
    });

    const data = Array.from(segmentsMap.values()).map(s => ({
        segment: s.segment,
        distribution: Array.from(s.distribution.entries()).map(([label, value]) => ({ label, value })),
        average: s.total > 0 ? parseFloat((s.sum / s.total).toFixed(2)) : 0,
        total: s.total
    }));

    data.sort((a, b) => a.segment.localeCompare(b.segment));

    return response(res, 200, "Segmented distribution fetched", {
        questionId, fieldName, type: question.type, data
    });
});

// Get summary statistics
exports.getInsightsSummary = asyncHandler(async (req, res) => {
    const { slug } = req.params;

    const form = await SurveyForm.findOne({ slug }).lean();
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

