const response = require("../utils/response");

const errorHandler = (err, req, res, next) => {
  console.error("❌ Error:", err);

  if (err.status) {
    // Handle custom validation or client errors
    return response(res, err.status, err.message, null, null);
  }

  // Default to internal server error for unhandled exceptions
  return response(res, 500, "Internal Server Error", null, err.message || "An unexpected error occurred.");
};

module.exports = errorHandler;
