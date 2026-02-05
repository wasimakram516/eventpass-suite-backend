const asyncHandler = require("../../middlewares/asyncHandler");
const response = require("../../utils/response");
const { deleteFromS3 } = require("../../utils/s3Storage");
const mongoose = require("mongoose");

/**
 * Universal Media Deletion Controller
 */
exports.deleteMedia = asyncHandler(async (req, res) => {
  const {
    fileUrl,
    eventId,
    mediaType,
    eventType = "public",
    removeBrandingLogoIds,
    gameId,
    memoryImageId,
    deleteAllMemoryImages,
  } = req.body;

  const isMemoryImageOperation = mediaType === "memoryImage" && gameId;

  if (!fileUrl && !isMemoryImageOperation) {
    return response(res, 400, "File URL is required");
  }

  try {
    if (fileUrl) {
      await deleteFromS3(fileUrl);
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

    if (gameId && mediaType && mongoose.Types.ObjectId.isValid(gameId)) {
      const Game = require("../../models/Game");
      const game = await Game.findById(gameId);

      if (!game) {
        return response(res, 404, "Game not found");
      }

      if (mediaType === "memoryImage") {
        if (deleteAllMemoryImages === true) {
          if (Array.isArray(game.memoryImages) && game.memoryImages.length > 0) {
            for (const img of game.memoryImages) {
              if (img && (img.key || img.url)) {
                try {
                  await deleteFromS3(img.key || img.url);
                } catch (err) {
                  console.warn("Failed to delete memory image from S3:", err);
                }
              }
            }
            game.memoryImages = [];
            if (game.setAuditUser && req.user) game.setAuditUser(req.user);
            await game.save();
            return response(res, 200, "All memory images deleted successfully", game);
          }
          return response(res, 200, "No memory images to delete", game);
        } else if (memoryImageId) {
          if (Array.isArray(game.memoryImages) && game.memoryImages.length > 0) {
            const imageIndex = game.memoryImages.findIndex(
              (img) => img._id && img._id.toString() === memoryImageId.toString()
            );

            if (imageIndex !== -1) {
              const img = game.memoryImages[imageIndex];
              if (img && (img.key || img.url)) {
                try {
                  await deleteFromS3(img.key || img.url);
                } catch (err) {
                  console.warn("Failed to delete memory image from S3:", err);
                }
              }
              game.memoryImages.splice(imageIndex, 1);
              if (game.setAuditUser && req.user) game.setAuditUser(req.user);
              await game.save();
              return response(res, 200, "Memory image deleted successfully", game);
            }
          }
          return response(res, 404, "Memory image not found");
        }
      }

      if (req.body.questionId) {
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

        if (game.setAuditUser && req.user) game.setAuditUser(req.user);
        await game.save();
        return response(res, 200, "Media deleted successfully", question);
      }
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
          if (form.setAuditUser && req.user) form.setAuditUser(req.user);
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
        if (poll.setAuditUser && req.user) poll.setAuditUser(req.user);
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

