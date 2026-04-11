const StageQSession = require("../../../models/StageQSession");

// Room prefix for StageQ sessions
const roomKey = (sessionSlug) => `stageq:${sessionSlug}`;

const stageqSocket = (io, socket) => {
  socket.on("joinSession", async (sessionSlug) => {
    try {
      const session = await StageQSession.findOne({ slug: sessionSlug });
      if (!session) {
        return socket.emit("error", "Invalid session slug");
      }

      const room = roomKey(sessionSlug);
      socket.join(room);
      console.log(`${socket.id} joined StageQ room: ${room}`);
    } catch (error) {
      console.error("stageq joinSession error:", error.message);
      socket.emit("error", "Session join failed");
    }
  });
};

module.exports = { stageqSocket, roomKey };
