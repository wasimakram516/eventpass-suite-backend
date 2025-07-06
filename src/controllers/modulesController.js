const { MODULES } = require("../constants/modules");
const response = require("../utils/response");

exports.getAllModules = (req, res) => {
  return response(res, 200, "Modules fetched", MODULES);
};
