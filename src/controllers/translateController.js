const { translate } = require("google-translate-api-x");
const response = require("../utils/response");

exports.translateText = async (req, res) => {
  const { text, targetLang } = req.body;

  // If no text or no target, just return original text with a note
  if (!text || !targetLang) {
    return response(
      res,
      200,
      "No translation needed, returning original text",
      text || ""
    );
  }

  try {
    const result = await translate(text, { to: targetLang });
    return response(res, 200, "Translation successful", result.text);
  } catch (err) {
    console.error("Translation error:", err);
    // On any error, return original text with a failure notice
    return response(
      res,
      200,
      "Translation failed, returning original text",
      text
    );
  }
};
