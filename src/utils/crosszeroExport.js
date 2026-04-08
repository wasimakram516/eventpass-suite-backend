const XLSX = require("xlsx");
const moment = require("moment");

function formatDateTime(value) {
  if (!value) return "-";
  return moment(value).format("YYYY-MM-DD hh:mm A");
}

function getAiOutcomeLabel(result) {
  switch (result) {
    case "X_wins":
      return "Player Won (X)";
    case "O_wins":
      return "AI Won (O)";
    case "draw":
      return "Draw";
    default:
      return "-";
  }
}

function getPvpOutcomeLabel(result) {
  switch (result) {
    case "X_wins":
      return "Player 1 (X) Won";
    case "O_wins":
      return "Player 2 (O) Won";
    case "draw":
      return "Draw";
    default:
      return "-";
  }
}

function buildMetadataRows(game, modeLabel, totalSessions, extraRows = []) {
  return [
    ["Business Name", game.businessId?.name || "-"],
    ["Game Title", game.title || "-"],
    ["Game Slug", game.slug || "-"],
    ["Game Mode", modeLabel],
    ["Move Timer (sec)", game.moveTimer || 0],
    ["Total Sessions", totalSessions],
    ...extraRows,
    ["Exported At", formatDateTime(new Date())],
  ];
}

function buildWorksheet(metadataRows, headers, dataRows, columnWidths = []) {
  const worksheetRows = [...metadataRows, [], headers, ...dataRows];
  const worksheet = XLSX.utils.aoa_to_sheet(worksheetRows);

  if (columnWidths.length) {
    worksheet["!cols"] = columnWidths.map((wch) => ({ wch }));
  }

  return worksheet;
}

module.exports = {
  buildMetadataRows,
  buildWorksheet,
  formatDateTime,
  getAiOutcomeLabel,
  getPvpOutcomeLabel,
};
