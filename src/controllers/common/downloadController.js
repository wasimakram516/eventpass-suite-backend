const path = require("path");
const response = require("../../utils/response");

exports.downloadEmployeeTemplate = (req, res) => {
  const filePath = path.resolve(__dirname, "../../templates/employee_template.csv");

  res.download(filePath, "employee_template.csv", (err) => {
    if (err) {
      console.error("Template download failed:", err);
      return response(res, 500, "Failed to download template.");
    }
  });
};
