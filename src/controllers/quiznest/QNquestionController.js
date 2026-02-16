const Game = require("../../models/Game");
const User = require("../../models/User");
const Business = require("../../models/Business");
const response = require("../../utils/response");
const asyncHandler = require("../../middlewares/asyncHandler");
const XLSX = require("xlsx");
const { recomputeAndEmit } = require("../../socket/dashboardSocket");
const { uploadToS3, deleteFromS3 } = require("../../utils/s3Storage");
const { createLog } = require("../../utils/logger");

// Download sample Excel template
exports.downloadSampleTemplate = asyncHandler(async (req, res) => {
  const choicesCount = parseInt(req.params.choicesCount, 10);
  const includeHint = req.query.includeHint === "true";

  if (![2, 3, 4, 5].includes(choicesCount)) {
    return response(res, 400, "Invalid choicesCount. Allowed: 2 to 5");
  }

  const sampleData = [
    {
      Question: "What is the capital of France?",
      CorrectAnswer: "Paris",
    },
  ];

  if (includeHint) {
    sampleData[0].Hint = "It's known as the City of Light";
  }

  for (let i = 1; i <= choicesCount; i++) {
    sampleData[0][`Option${i}`] = [
      "Paris",
      "Rome",
      "Berlin",
      "Madrid",
      "Lisbon",
    ][i - 1];
  }

  const worksheet = XLSX.utils.json_to_sheet(sampleData);
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, worksheet, "Sample");

  const buffer = XLSX.write(workbook, { type: "buffer", bookType: "xlsx" });

  res.setHeader(
    "Content-Disposition",
    `attachment; filename=quiz-sample-${choicesCount}.xlsx`
  );
  res.setHeader(
    "Content-Type",
    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
  );
  res.status(200).send(buffer);
});

// Upload Excel and replace all questions
exports.uploadQuestions = asyncHandler(async (req, res) => {
  const gameId = req.params.gameId;
  if (!req.file) return response(res, 400, "No file uploaded");

  const game = await Game.findOne({
    _id: gameId,
    type: "quiz",
    mode: "solo",
  });

  if (!game) return response(res, 404, "Game not found");

  const workbook = XLSX.read(req.file.buffer, { type: "buffer" });
  const sheet = workbook.Sheets[workbook.SheetNames[0]];
  const rows = XLSX.utils.sheet_to_json(sheet);

  if (!rows.length) return response(res, 400, "Excel file is empty");

  const questions = rows.map((row, index) => {
    const questionText = row["Question"]?.toString().trim();
    const choicesCount = game.choicesCount;

    if (!questionText) {
      throw new Error(`Row ${index + 2}: Missing or invalid Question`);
    }

    const answers = [];
    for (let i = 1; i <= choicesCount; i++) {
      const optionKey = `Option${i}`;
      const value = row[optionKey];
      if (
        value === undefined ||
        value === null ||
        value.toString().trim() === ""
      ) {
        throw new Error(
          `Row "${questionText}": Missing or invalid ${optionKey}`
        );
      }
      answers.push(value.toString().trim());
    }

    const correctAnswerRaw = row["CorrectAnswer"];
    const correctAnswer = correctAnswerRaw?.toString().trim();

    if (!correctAnswer) {
      throw new Error(
        `Row "${questionText}": Missing or invalid CorrectAnswer`
      );
    }

    const correctIndex = answers.findIndex((a) => a === correctAnswer);
    if (correctIndex === -1) {
      throw new Error(
        `Row "${questionText}": CorrectAnswer "${correctAnswer}" does not match any of the ${choicesCount} options`
      );
    }

    const hint = row["Hint"]?.toString().trim() || "";

    return {
      question: questionText,
      answers,
      correctAnswerIndex: correctIndex,
      hint,
    };
  });

  game.questions = questions;
  for (let i = 0; i < game.questions.length; i++) {
    if (req.user) game.questions[i].setAuditUser(req.user);
  }
  game.setAuditUser(req.user);
  await game.save();

  recomputeAndEmit(game.businessId || null).catch((err) =>
    console.error("Background recompute failed:", err.message)
  );

  // Log each uploaded question as "Question" create (not Game update)
  const userId = req.user?._id ?? req.user?.id ?? null;
  if (userId && game.questions?.length) {
    const businessId = game.businessId ?? null;
    for (const q of game.questions) {
      if (q._id) {
        createLog({
          userId,
          logType: "create",
          itemType: "Question",
          itemId: q._id,
          businessId,
          module: "QuizNest",
        });
      }
    }
  }

  return response(res, 200, "Questions uploaded successfully", {
    count: questions.length,
  });
});

// Get all questions for a game (manually populate createdBy/updatedBy so names are returned)
exports.getQuestions = asyncHandler(async (req, res) => {
  const game = await Game.findOne({
    _id: req.params.gameId,
    type: "quiz",
    mode: "solo",
  });

  if (!game) return response(res, 404, "Game not found");

  const activeQuestions = game.questions.filter(
    (question) => !question.isDeleted
  );

  const userIds = new Set();
  activeQuestions.forEach((q) => {
    if (q.createdBy) userIds.add(q.createdBy.toString());
    if (q.updatedBy) userIds.add(q.updatedBy.toString());
  });
  const users =
    userIds.size > 0
      ? await User.find({ _id: { $in: [...userIds] } })
        .select("name")
        .lean()
      : [];
  const userMap = new Map(users.map((u) => [u._id.toString(), { _id: u._id, name: u.name }]));

  const withUserNames = activeQuestions.map((q) => {
    const plain = q.toObject ? q.toObject() : { ...q };
    plain.createdBy = plain.createdBy
      ? userMap.get(plain.createdBy.toString()) || { _id: plain.createdBy, name: null }
      : null;
    plain.updatedBy = plain.updatedBy
      ? userMap.get(plain.updatedBy.toString()) || { _id: plain.updatedBy, name: null }
      : null;
    return plain;
  });

  return response(res, 200, "Questions retrieved", withUserNames);
});

// Add a single question
exports.addQuestion = asyncHandler(async (req, res) => {
  if (!req.body) {
    return response(res, 400, "Request body is required");
  }

  const { question, answers, correctAnswerIndex, hint, questionImage, answerImages } = req.body;

  if (!question || !answers || correctAnswerIndex === undefined) {
    return response(res, 400, "All fields are required");
  }

  const game = await Game.findOne({
    _id: req.params.gameId,
    type: "quiz",
    mode: "solo",
  });

  if (!game) return response(res, 404, "Game not found");

  const parsedAnswers =
    typeof answers === "string" ? JSON.parse(answers) : answers;

  if (parsedAnswers.length !== game.choicesCount) {
    return response(
      res,
      400,
      `This quiz requires exactly ${game.choicesCount} options`
    );
  }

  const processedAnswerImages = Array(game.choicesCount).fill(null);
  if (Array.isArray(answerImages)) {
    answerImages.forEach((url, idx) => {
      if (idx < processedAnswerImages.length && url) {
        processedAnswerImages[idx] = url;
      }
    });
  }

  game.questions.push({
    question,
    questionImage: questionImage || null,
    answers: parsedAnswers,
    answerImages: processedAnswerImages,
    correctAnswerIndex: parseInt(correctAnswerIndex),
    hint: hint || "",
  });
  const lastQ = game.questions.at(-1);
  if (lastQ && req.user) lastQ.setAuditUser(req.user);

  game.setAuditUser(req.user);
  await game.save();

  recomputeAndEmit(game.businessId || null).catch((err) =>
    console.error("Background recompute failed:", err.message)
  );

  const added = game.questions.at(-1);
  const out = added.toObject ? added.toObject() : { ...added };
  if (req.user) {
    const userId = req.user._id || req.user.id;
    const u = userId ? await User.findById(userId).select("name").lean() : null;
    const userName = u?.name ?? req.user.name ?? null;
    out.createdBy = { _id: userId, name: userName };
    out.updatedBy = { _id: userId, name: userName };
  }
  return response(res, 201, "Question added", out);
});

// Update a question
exports.updateQuestion = asyncHandler(async (req, res) => {
  if (!req.body) {
    return response(res, 400, "Request body is required");
  }

  const {
    question,
    answers,
    correctAnswerIndex,
    hint,
    questionImage,
    answerImages,
    removeQuestionImage,
    removeAnswerImages,
  } = req.body;

  const game = await Game.findOne({
    _id: req.params.gameId,
    type: "quiz",
    mode: "solo",
  });

  if (!game) return response(res, 404, "Game not found");

  const q = game.questions.id(req.params.questionId);
  if (!q) return response(res, 404, "Question not found");

  const parsedAnswers = answers
    ? typeof answers === "string"
      ? JSON.parse(answers)
      : answers
    : null;

  if (parsedAnswers && parsedAnswers.length !== game.choicesCount) {
    return response(
      res,
      400,
      `This quiz requires exactly ${game.choicesCount} options`
    );
  }

  if (removeQuestionImage === "true") {
    if (q.questionImage) await deleteFromS3(q.questionImage);
    q.questionImage = null;
  } else if (questionImage !== undefined) {
    if (q.questionImage && q.questionImage !== questionImage) {
      await deleteFromS3(q.questionImage);
    }
    q.questionImage = questionImage || null;
  }

  if (removeAnswerImages && Array.isArray(removeAnswerImages)) {
    for (const index of removeAnswerImages) {
      if (q.answerImages[index]) {
        await deleteFromS3(q.answerImages[index]);
        q.answerImages[index] = null;
      }
    }
  }

  if (answerImages !== undefined && Array.isArray(answerImages)) {
    const newAnswerImages = Array(game.choicesCount).fill(null);

    if (q.answerImages && Array.isArray(q.answerImages)) {
      for (let idx = 0; idx < q.answerImages.length; idx++) {
        const img = q.answerImages[idx];
        if (idx < newAnswerImages.length && img && !removeAnswerImages?.includes(idx)) {
          newAnswerImages[idx] = img;
        }
      }
    }

    for (let idx = 0; idx < answerImages.length; idx++) {
      const url = answerImages[idx];
      if (idx < newAnswerImages.length && url) {
        if (newAnswerImages[idx] && newAnswerImages[idx] !== url) {
          await deleteFromS3(newAnswerImages[idx]).catch(console.error);
        }
        newAnswerImages[idx] = url;
      }
    }

    q.answerImages = newAnswerImages;
  }

  q.question = question || q.question;
  q.answers = parsedAnswers || q.answers;
  q.correctAnswerIndex =
    correctAnswerIndex !== undefined
      ? parseInt(correctAnswerIndex)
      : q.correctAnswerIndex;
  q.hint = hint !== undefined ? hint : q.hint;
  if (req.user) q.setAuditUser(req.user);

  game.setAuditUser(req.user);
  await game.save();

  recomputeAndEmit(game.businessId || null).catch((err) =>
    console.error("Background recompute failed:", err.message)
  );

  const out = q.toObject ? q.toObject() : { ...q };
  const ids = [out.createdBy, out.updatedBy].filter(Boolean).map((id) => (id && id.toString ? id.toString() : id));
  if (ids.length > 0) {
    const users = await User.find({ _id: { $in: ids } }).select("name").lean();
    const map = new Map(users.map((u) => [u._id.toString(), { _id: u._id, name: u.name }]));
    out.createdBy = out.createdBy ? (map.get(out.createdBy.toString()) || { _id: out.createdBy, name: null }) : null;
    out.updatedBy = out.updatedBy ? (map.get(out.updatedBy.toString()) || { _id: out.updatedBy, name: null }) : null;
  }
  return response(res, 200, "Question updated", out);
});

// Delete a question (soft delete)
exports.deleteQuestion = asyncHandler(async (req, res) => {
  const game = await Game.findOne({
    _id: req.params.gameId,
    type: "quiz",
    mode: "solo",
  });

  if (!game) return response(res, 404, "Game not found");

  const q = game.questions.id(req.params.questionId);
  if (!q) return response(res, 404, "Question not found");

  if (q.questionImage) await deleteFromS3(q.questionImage).catch(console.error);

  for (const img of q.answerImages.filter(Boolean)) {
    await deleteFromS3(img).catch(console.error);
  }

  await q.softDelete(req.user.id);
  game.setAuditUser(req.user);
  await game.save();

  recomputeAndEmit(game.businessId || null).catch((err) =>
    console.error("Background recompute failed:", err.message)
  );

  return response(res, 200, "Question moved to recycle bin");
});

// Restore a question
exports.restoreQuestion = asyncHandler(async (req, res) => {
  const { id } = req.params;
  const game = await Game.findOne({
    "questions._id": id,
    "questions.isDeleted": true,
    mode: "solo",
    type: "quiz",
  });

  if (!game)
    return response(res, 404, "Deleted question not found in solo games");

  const q = game.questions.id(id);
  if (!q || !q.isDeleted)
    return response(res, 404, "Question not found in trash");

  await q.restore();
  game.setAuditUser(req.user);
  await game.save();

  recomputeAndEmit(game.businessId || null).catch((err) =>
    console.error("Background recompute failed:", err.message)
  );

  return response(res, 200, "Question restored", q);
});

// Permanently delete a question
exports.permanentDeleteQuestion = asyncHandler(async (req, res) => {
  const { id } = req.params;
  const game = await Game.findOne({
    "questions._id": id,
    "questions.isDeleted": true,
    mode: "solo",
    type: "quiz",
  });
  if (!game)
    return response(res, 404, "Deleted question not found in solo games");

  const questionIndex = game.questions.findIndex(
    (q) => q._id.toString() === id
  );
  if (questionIndex === -1) return response(res, 404, "Question not found");

  const q = game.questions[questionIndex];

  if (q.questionImage) await deleteFromS3(q.questionImage).catch(console.error);

  for (const img of q.answerImages.filter(Boolean)) {
    await deleteFromS3(img).catch(console.error);
  }

  game.questions.splice(questionIndex, 1);
  game.setAuditUser(req.user);
  await game.save();

  recomputeAndEmit(game.businessId || null).catch((err) =>
    console.error("Background recompute failed:", err.message)
  );

  return response(res, 200, "Question permanently deleted");
});

// Restore all questions
exports.restoreAllQuestions = asyncHandler(async (req, res) => {
  const games = await Game.find({
    mode: "solo",
    type: "quiz",
  });

  let restoredCount = 0;

  for (const game of games) {
    const deletedQuestions = game.questions.filter((q) => q.isDeleted);
    if (deletedQuestions.length > 0) {
      for (const question of deletedQuestions) {
        await question.restore();
      }
      game.setAuditUser(req.user);
      await game.save();
      restoredCount += deletedQuestions.length;
    }
  }

  if (restoredCount === 0) {
    return response(
      res,
      404,
      "No deleted questions found in solo games to restore"
    );
  }

  recomputeAndEmit(null).catch((err) =>
    console.error("Background recompute failed:", err.message)
  );

  return response(res, 200, `Restored ${restoredCount} questions`);
});

// Permanent delete all questions
exports.permanentDeleteAllQuestions = asyncHandler(async (req, res) => {
  const games = await Game.find({
    mode: "solo",
    type: "quiz",
  });

  let deletedCount = 0;

  for (const game of games) {
    const deletedQuestions = game.questions.filter((q) => q.isDeleted);
    if (deletedQuestions.length > 0) {
      game.questions = game.questions.filter((q) => !q.isDeleted);
      game.setAuditUser(req.user);
      await game.save();
      deletedCount += deletedQuestions.length;
    }
  }

  if (deletedCount === 0) {
    return response(
      res,
      404,
      "No deleted questions found in solo games to permanently delete"
    );
  }

  recomputeAndEmit(null).catch((err) =>
    console.error("Background recompute failed:", err.message)
  );

  return response(res, 200, `Permanently deleted ${deletedCount} questions`);
});
