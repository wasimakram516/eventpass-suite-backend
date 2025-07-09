const XLSX = require("xlsx");
const cloudinary = require("cloudinary").v2;

/**
 * Validates employee data from CSV rows.
 */
const validateEmployeeData = (rows) => {
  // Ensure required headers are present
  if (!rows.every(row => row.employeeId && row.tableNumber && row.imageName)) {
    throw new Error("Each row must have 'employeeId', 'tableNumber', and 'imageName'.");
  }

  // Get all unique headers from the first row (assuming all rows have the same structure)
  const validHeaders = ["employeeId", "tableNumber", "imageName", "employeeName"];
  const rowHeaders = Object.keys(rows[0]);

  // Ensure no extra headers exist
  if (!rowHeaders.every(header => validHeaders.includes(header))) {
    throw new Error("Invalid header found. Only 'employeeId', 'tableNumber', 'imageName', and optionally 'employeeName' are allowed.");
  }

  // Check for empty required fields
  const emptyRows = rows.filter(row => !row.employeeId || !row.tableNumber);
  if (emptyRows.length > 0) {
    throw new Error("Employee ID or Table Number cannot be empty.");
  }

  // Check for duplicate employee IDs
  const employeeIds = rows.map(row => row.employeeId);
  if (new Set(employeeIds).size !== employeeIds.length) {
    throw new Error("Duplicate employee IDs found in the file.");
  }
};

/**
 * Uploads table images and links them with CSV rows.
 */
const handleTableImages = async (rows, uploadedFiles) => {
  return await Promise.all(
    rows.map(async (row) => {
      if (row.imageName) {
        const matchingFile = uploadedFiles.find(
          (file) => file.originalname === row.imageName
        );
        if (!matchingFile) {
          throw new Error(
            `Image "${row.imageName}" specified in the CSV file was not found in the uploaded files. Please ensure the names match exactly.`
          );
        }

        try {
          const uploadResult = await new Promise((resolve, reject) => {
            cloudinary.uploader.upload_stream(
              { folder: "table-images" },
              (error, result) => {
                if (error) return reject(error);
                resolve(result);
              }
            ).end(matchingFile.buffer);
          });

          row.tableImage = uploadResult.secure_url;
        } catch (error) {
          console.error("Failed to upload table image:", error);
          throw new Error("Failed to upload table image to Cloudinary.");
        }
      }
      return row;
    })
  );
};

/**
 * Processes and validates the employeeData file and images.
 */
const processEmployeeData = async (fileBuffer, uploadedFiles) => {
  const workbook = XLSX.read(fileBuffer, { type: "buffer" });
  const sheetName = workbook.SheetNames[0];
  const rows = XLSX.utils.sheet_to_json(workbook.Sheets[sheetName]);

  validateEmployeeData(rows);

  return await handleTableImages(rows, uploadedFiles);
};

module.exports = {
  validateEmployeeData,
  handleTableImages,
  processEmployeeData,
};
