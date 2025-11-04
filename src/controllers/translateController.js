const response = require("../utils/response");
const { translateText } = require("../services/translationService");

exports.translateText = async (req, res) => {
  try {
    const { text, targetLang } = req.body;
    const output = await translateText(text, targetLang);
    return response(res, 200, "Translation successful", output);
  } catch (err) {
    console.error("⚠️ Translation controller error:", err);
    return response(res, 200, "Translation failed", req.body.text);
  }
};
