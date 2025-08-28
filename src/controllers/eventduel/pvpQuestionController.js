const Game = require("../../models/Game");
const response = require("../../utils/response");
const asyncHandler = require("../../middlewares/asyncHandler");
const XLSX = require("xlsx");

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

  const game = await Game.findById(gameId);
  if (!game || game.mode !== "pvp") return response(res, 404, "PvP game not found");

  const workbook = XLSX.read(req.file.buffer, { type: "buffer" });
  const sheet = workbook.Sheets[workbook.SheetNames[0]];
  const rows = XLSX.utils.sheet_to_json(sheet);

  if (!rows.length) return response(res, 400, "Excel file is empty");

  const questions = rows.map((row, index) => {
    const questionText = row["Question"]?.toString().trim();
    const choicesCount = game.choicesCount;

    if (!questionText) throw new Error(`Row ${index + 2}: Missing Question`);

    const answers = [];
    for (let i = 1; i <= choicesCount; i++) {
      const value = row[`Option${i}`];
      if (!value) throw new Error(`Row ${index + 2}: Missing Option${i}`);
      answers.push(value.toString().trim());
    }

    const correctAnswer = row["CorrectAnswer"]?.toString().trim();
    const correctIndex = answers.findIndex((a) => a === correctAnswer);
    if (correctIndex === -1) throw new Error(`Row ${index + 2}: Invalid CorrectAnswer`);

    const hint = row["Hint"]?.toString().trim() || "";

    return {
      question: questionText,
      answers,
      correctAnswerIndex: correctIndex,
      hint,
    };
  });

  game.questions = questions;
  await game.save();

  return response(res, 200, "Questions uploaded", { count: questions.length });
});


// Get all questions for a game
exports.getQuestions = asyncHandler(async (req, res) => {
  const { gameId } = req.params;
  
  const game = await Game.findById(gameId).notDeleted();
  if (!game) return response(res, 404, "Game not found");
  
  const activeQuestions = game.questions.filter(q => !q.isDeleted);
  
  return response(res, 200, "Questions fetched", activeQuestions);
});

// Add a single question
exports.addQuestion = asyncHandler(async (req, res) => {
  const { question, answers, correctAnswerIndex, hint } = req.body;

  if (!question || !answers || correctAnswerIndex === undefined) {
    return response(res, 400, "All fields are required");
  }

  const game = await Game.findById(req.params.gameId);
  if (!game || game.mode !== "pvp") return response(res, 404, "PvP game not found");

  if (answers.length !== game.choicesCount) {
    return response(
      res,
      400,
      `This quiz requires exactly ${game.choicesCount} options`
    );
  }

  game.questions.push({
    question,
    answers,
    correctAnswerIndex,
    hint: hint || "", // optional
  });

  await game.save();

  return response(res, 201, "Question added", game.questions.at(-1));
});

// Update a question
exports.updateQuestion = asyncHandler(async (req, res) => {
  const { question, answers, correctAnswerIndex, hint } = req.body;

  const game = await Game.findById(req.params.gameId);
  if (!game || game.mode !== "pvp") return response(res, 404, "PvP game not found");

  const q = game.questions.id(req.params.questionId);
  if (!q) return response(res, 404, "Question not found");

  if (answers && answers.length !== game.choicesCount) {
    return response(
      res,
      400,
      `This quiz requires exactly ${game.choicesCount} options`
    );
  }

  q.question = question || q.question;
  q.answers = answers || q.answers;
  q.correctAnswerIndex = correctAnswerIndex ?? q.correctAnswerIndex;
  q.hint = hint ?? q.hint; // update hint if provided

  await game.save();
  return response(res, 200, "Question updated", q);
});

// Soft delete a question (keep name as deleteQuestion)
exports.deleteQuestion = asyncHandler(async (req, res) => {
  const { gameId, questionId } = req.params;
  
  const game = await Game.findById(gameId).notDeleted();
  if (!game) return response(res, 404, "Game not found");
  
  const questionIndex = game.questions.findIndex(q => q._id.toString() === questionId);
  if (questionIndex === -1) return response(res, 404, "Question not found");
  
  game.questions[questionIndex].isDeleted = true; 
  game.questions[questionIndex].deletedAt = new Date();
  game.questions[questionIndex].deletedBy = req.user.id; 
  await game.save();
  return response(res, 200, "Question moved to recycle bin");
});
 
exports.restoreQuestion = asyncHandler(async (req, res) => {
  const { id } = req.params; 

  const game = await Game.findOne({
    "questions._id": id,
    "questions.isDeleted": true
  });
  
  if (!game) return response(res, 404, "Deleted question not found");
  
  const questionIndex = game.questions.findIndex(q => q._id.toString() === id && q.isDeleted);
  if (questionIndex === -1) return response(res, 404, "Question not found in trash");
  
  game.questions[questionIndex].isDeleted = false;
  delete game.questions[questionIndex].deletedAt; 
  delete game.questions[questionIndex].deletedBy; 
  
  await game.save();
  return response(res, 200, "Question restored successfully");
});

exports.permanentDeleteQuestion = asyncHandler(async (req, res) => {
  const { id } = req.params; 
  
  const game = await Game.findOne({
    "questions._id": id,
    "questions.isDeleted": true 
  });
  
  if (!game) return response(res, 404, "Deleted question not found");
  
  game.questions = game.questions.filter(q => q._id.toString() !== id); 
  
  await game.save();
  return response(res, 200, "Question permanently deleted");
});
