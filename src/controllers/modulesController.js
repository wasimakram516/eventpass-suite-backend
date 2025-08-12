const { getModulesForRole } = require("../constants/modules");
const response = require("../utils/response");

exports.getAllModules = (req, res) => {
  const role = (req.query.role || "").toLowerCase() || "staff";

  const data = getModulesForRole(role);
  return response(res, 200, "Modules fetched", data);
};
