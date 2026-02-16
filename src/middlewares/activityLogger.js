const { createLog } = require("../utils/logger");

const activityLogger = (config) => async (req, res, next) => {

    // ── Pre-resolve businessId if an async getter is provided ─────────────────
    // We do this BEFORE the controller runs so the document still exists
    if (typeof config.preFetchBusinessId === "function") {
        try {
            req._logBusinessId = await config.preFetchBusinessId(req);
        } catch (err) {
            console.error("[ActivityLogger] preFetchBusinessId failed:", err.message);
            req._logBusinessId = null;
        }
    }

    const originalJson = res.json.bind(res);

    res.json = function (body) {
        if (res.statusCode >= 200 && res.statusCode < 300) {
            resolveAndLog(config, req, body).catch((err) =>
                console.error("[ActivityLogger] Failed to build log:", err.message)
            );
        }
        return originalJson(body);
    };

    next();
};

async function resolveAndLog(config, req, body) {
    const data = body?.data ?? {};

    // ── Resolve itemId ────────────────────────────────────────────────────────
    let itemId = null;
    if (typeof config.getItemId === "function") {
        itemId = config.getItemId(req, data) ?? null;
    } else {
        itemId = data?._id ?? data?.id ?? null;
    }

    // ── Skip logging if no user (public-facing action) ────────────────────────
    const userId = req.user?._id ?? req.user?.id ?? null;
    if (!userId) return; // ← this is the key line — no user = public = skip

    // ── Resolve businessId ────────────────────────────────────────────────────
    let businessId =
        req._logBusinessId ??
        (typeof config.getBusinessId === "function"
            ? await config.getBusinessId(req, data)
            : null) ??
        data?.businessId ??
        req.body?.businessId ??
        req.query?.businessId ??
        null;

    createLog({
        userId,
        logType: config.logType,
        itemType: config.itemType ?? null,
        itemId,
        businessId,
        module: config.module ?? "Other",
    });
}

module.exports = activityLogger;