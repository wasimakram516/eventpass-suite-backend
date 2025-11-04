const axios = require("axios");
const env = require("../config/env");

const GOOGLE_API_URL = env.googleTranslate.apiUrl;

/**
 * Translates one or many texts into a target language.
 * @param {string|string[]} text
 * @param {string} targetLang
 * @returns {Promise<string|string[]>}
 */
async function translateText(text, targetLang) {
  if (!text || !targetLang) return text;
  const apiKey = env.googleTranslate.apiKey;
  const texts = Array.isArray(text) ? text : [text];

  try {
    const { data } = await axios.post(
      `${GOOGLE_API_URL}?key=${apiKey}`,
      { q: texts, target: targetLang, format: "text" },
      { headers: { "Content-Type": "application/json" }, timeout: 10000 }
    );

    const translations =
      data?.data?.translations?.map((t) => t.translatedText) || texts;
    return Array.isArray(text) ? translations : translations[0];
  } catch (err) {
    console.error("⚠️ Translation API error:", err.message);
    return text; // graceful fallback
  }
}

module.exports = { translateText };
