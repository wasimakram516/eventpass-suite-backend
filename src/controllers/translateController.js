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

  try {
    const result = await translate(text, { to: targetLang });

    return response(res, 200, "Translation successful", {
      translatedText: result.text,
    });
  } catch (err) {
     return response(
       res,
       500,
       "Translation failed",
       null,
       err.message || "Internal server error"
     );
  }
};
