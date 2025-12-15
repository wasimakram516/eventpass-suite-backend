const asyncHandler = require("../../middlewares/asyncHandler");
const response = require("../../utils/response");
const { deleteFromS3 } = require("../../utils/s3Storage");
const { deleteImage } = require("../../config/cloudinary");
const mongoose = require("mongoose");

/**
 * Universal Media Deletion Controller
 */
exports.deleteMedia = asyncHandler(async (req, res) => {
  const {
    fileUrl,
    storageType = "s3",
    eventId,
    mediaType,
    eventType = "public",
    removeBrandingLogoIds,
  } = req.body;

  if (!fileUrl) {
    return response(res, 400, "File URL is required");
  }

  try {
    if (storageType === "s3") {
      await deleteFromS3(fileUrl);
    } else if (storageType === "cloudinary") {
      await deleteImage(fileUrl);
    } else {
      return response(res, 400, "Invalid storage type. Use 's3' or 'cloudinary'");
    }

    if (eventId && mediaType && mongoose.Types.ObjectId.isValid(eventId)) {
      const Event = require("../../models/Event");
      const event = await Event.findById(eventId);

      if (!event) {
        return response(res, 404, "Event not found");
      }

      const updates = {};

      if (mediaType === "logo") {
        updates.logoUrl = null;
      } else if (mediaType === "backgroundEn") {
        updates.background = {
          ...(event.background || {}),
          en: null,
        };
      } else if (mediaType === "backgroundAr") {
        updates.background = {
          ...(event.background || {}),
          ar: null,
        };
      } else if (mediaType === "brandingLogo") {
        const removeIds = removeBrandingLogoIds || [];
        if (removeIds.length && Array.isArray(removeIds)) {
          const existingBranding = event.brandingMedia || [];
          const removeIdsSet = new Set(removeIds.map(String));

          for (const media of existingBranding) {
            if (removeIdsSet.has(String(media._id)) && media.logoUrl) {
              try {
                await deleteFromS3(media.logoUrl);
              } catch (err) {
                console.error("Failed to delete branding logo from S3:", err);
              }
            }
          }

          updates.brandingMedia = existingBranding.filter(
            (media) => !removeIdsSet.has(String(media._id))
          );
        }
      } else if (mediaType === "agenda") {
        updates.agendaUrl = null;
      }

      if (Object.keys(updates).length > 0) {
        const updatedEvent = await Event.findByIdAndUpdate(eventId, updates, {
          new: true,
        });
        return response(res, 200, "Media deleted successfully", updatedEvent);
      }
    }

    if (req.body.gameId && req.body.questionId && mediaType && mongoose.Types.ObjectId.isValid(req.body.gameId)) {
      const Game = require("../../models/Game");
      const game = await Game.findById(req.body.gameId);

      if (!game) {
        return response(res, 404, "Game not found");
      }

      const question = game.questions.id(req.body.questionId);
      if (!question) {
        return response(res, 404, "Question not found");
      }

      if (mediaType === "question") {
        question.questionImage = null;
      } else if (mediaType === "answer" && req.body.answerImageIndex !== undefined) {
        const index = parseInt(req.body.answerImageIndex);
        if (question.answerImages && question.answerImages[index]) {
          question.answerImages[index] = null;
        }
      }

      await game.save();
      return response(res, 200, "Media deleted successfully", question);
    }

    if (req.body.formId && mediaType === "optionImage" && mongoose.Types.ObjectId.isValid(req.body.formId)) {
      const SurveyForm = require("../../models/SurveyForm");
      const form = await SurveyForm.findById(req.body.formId);

      if (!form) {
        return response(res, 404, "Survey form not found");
      }

      const questionIndex = parseInt(req.body.questionIndex);
      const optionIndex = parseInt(req.body.optionIndex);

      if (form.questions && form.questions[questionIndex] && form.questions[questionIndex].options) {
        const option = form.questions[questionIndex].options[optionIndex];
        if (option) {
          option.imageUrl = null;
          await form.save();
          return response(res, 200, "Media deleted successfully", form);
        }
      }

      return response(res, 404, "Option not found");
    }

    if (req.body.pollId && mediaType === "optionImage" && mongoose.Types.ObjectId.isValid(req.body.pollId)) {
      const Poll = require("../../models/Poll");
      const poll = await Poll.findById(req.body.pollId);

      if (!poll) {
        return response(res, 404, "Poll not found");
      }

      const optionIndex = parseInt(req.body.optionIndex);

      if (poll.options && poll.options[optionIndex]) {
        poll.options[optionIndex].imageUrl = null;
        await poll.save();
        return response(res, 200, "Media deleted successfully", poll);
      }

      return response(res, 404, "Option not found");
    }

    if (req.body.spinWheelId && mediaType && mongoose.Types.ObjectId.isValid(req.body.spinWheelId)) {
      const SpinWheel = require("../../models/SpinWheel");
      const wheel = await SpinWheel.findById(req.body.spinWheelId);

      if (!wheel) {
        return response(res, 404, "Spin wheel not found");
      }

      const updates = {};

      if (mediaType === "logo") {
        updates.logoUrl = null;
      } else if (mediaType === "background") {
        updates.backgroundUrl = null;
      }

      if (Object.keys(updates).length > 0) {
        const updatedWheel = await SpinWheel.findByIdAndUpdate(req.body.spinWheelId, updates, {
          new: true,
        });
        return response(res, 200, "Media deleted successfully", updatedWheel);
      }
    }

    return response(res, 200, "Media deleted successfully");
  } catch (error) {
    console.error("Media deletion error:", error);
    return response(res, 500, "Failed to delete media", null, error.message);
  }
});

