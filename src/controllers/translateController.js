const { translate } = require("google-translate-api-x");
const response = require("../utils/response");

exports.translateText = async (req, res) => {
  const { text, targetLang } = req.body;

  if (!text || !targetLang) {
    return response(
      res,
      400,
      "Missing text or target language",
      null,
      "Missing required fields"
    );
  }

  const result = await translate(text, { to: targetLang });

  return response(res, 200, "Translation successful", result.text);
};
