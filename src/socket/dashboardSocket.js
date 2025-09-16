const { recalcMetrics } = require("../services/statsService");
const { emitUpdate } = require("../utils/socketUtils");

async function recomputeAndEmit(businessId = null) {
  console.log(`📊 Manual recompute requested`, businessId ? { businessId } : "global");

  // Always recompute superadmin
  const superadminMetrics = await recalcMetrics("superadmin");
  emitUpdate("metricsUpdated", superadminMetrics);

  if (businessId) {
    const businessMetrics = await recalcMetrics("business", businessId);
    emitUpdate("metricsUpdated", businessMetrics);
  }
}

const dashboardSocket = (io, socket) => {
  socket.on("recomputeMetrics", async ({ businessId = null }) => {
    try {
      await recomputeAndEmit(businessId);
    } catch (err) {
      console.error("❌ dashboard recompute error:", err.message);
      socket.emit("metricsError", "Failed to recompute metrics");
    }
  });
};

module.exports = { dashboardSocket, recomputeAndEmit };
