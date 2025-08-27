const Game = require("../../../models/Game");
const GameSession = require("../../../models/GameSession");

const eventDuelSocket = (io, socket) => {
  // Join PvP game room by gameSlug
  socket.on("joinGameRoom", async (gameSlug) => {
    try {
      const game = await Game.findOne({ slug: gameSlug });
      if (!game || game.mode !== "pvp") {
        return socket.emit("error", "Invalid or non-PvP gameSlug");
      }

      socket.join(gameSlug);
      console.log(`🎮 ${socket.id} joined EventDuel room: ${gameSlug}`);

      const sessions = await GameSession.find({ gameId: game._id })
        .populate("players.playerId winner gameId")
        .sort({ createdAt: -1 });

      socket.emit("pvpSessionsUpdate", sessions);
    } catch (error) {
      console.error("❌ EventDuel register error:", error.message);
      socket.emit("error", "Game room registration failed");
    }
  });

  // (Optional) Still allow joining by sessionId (for 1-to-1 targeting if needed)
  socket.on("joinSession", ({ sessionId }) => {
    if (sessionId) {
      socket.join(sessionId);
      console.log(`🎯 ${socket.id} joined EventDuel session: ${sessionId}`);
    } else {
      console.warn(`⚠️ ${socket.id} tried to join without sessionId`);
      socket.emit("error", "Session ID is required to join");
    }
  });

  socket.on("getAllSessions", async ({ gameSlug }) => {
  const game = await Game.findOne({ slug: gameSlug }).notDeleted();
  if (!game) return;

  const allSessions = await GameSession.find({ gameId: game._id }).notDeleted()
      .populate("players.playerId winner gameId")
      .sort({ createdAt: -1 })
      .limit(5);

  io.to(game.slug).emit("pvpAllSessions", allSessions);

});

};

module.exports = eventDuelSocket;
