const eventDuelSocket = (io, socket) => {
  socket.on("joinSession", ({ sessionId }) => {
    if (sessionId) {
      socket.join(sessionId);
      console.log(`🎮 ${socket.id} joined EventDuel session: ${sessionId}`);
    } else {
      console.warn(`⚠️ ${socket.id} tried to join without sessionId`);
      socket.emit("error", "Session ID is required to join");
    }
  });

};

module.exports = eventDuelSocket;
