const response = (res, status, message, data = null, error = null) => {
  return res.status(status).json({
    success: status >= 200 && status < 300, // true if status is 2xx
    message,
    data,
    error,
  });
};

module.exports = response;
