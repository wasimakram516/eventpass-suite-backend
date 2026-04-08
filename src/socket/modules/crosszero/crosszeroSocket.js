const Game = require("../../../models/Game");
const GameSession = require("../../../models/GameSession");
const { processMove } = require("../../../controllers/crosszero/CZgameSessionController");

function populateSession(query) {
  return query.populate([
    { path: "players.playerId", select: "name company" },
    { path: "winner", select: "name company" },
    {
      path: "gameId",
      select: "title slug mode type moveTimer countdownTimer gameSessionTimer xImage oImage",
    },
  ]);
}

function populateRecentSessions(gameId) {
  return populateSession(
    GameSession.find({ gameId }).notDeleted().sort({ createdAt: -1 }).limit(5)
  );
}

const crosszeroSocket = (io, socket) => {
  /**
   * Join a CrossZero game room by gameSlug
   * Emits: cz:sessionsUpdate — recent sessions for the lobby
   */
  socket.on("cz:joinGameRoom", async (gameSlug) => {
    try {
      const game = await Game.findOne({ slug: gameSlug, type: "xo", mode: "pvp" }).notDeleted();
      if (!game) {
        return socket.emit("error", "CrossZero game not found");
      }

      socket.join(gameSlug);
      console.log(`${socket.id} joined CrossZero room: ${gameSlug}`);

      const sessions = await populateRecentSessions(game._id);

      socket.emit("cz:sessionsUpdate", sessions);
      socket.emit("cz:allSessions", sessions);
    } catch (err) {
      console.error("cz:joinGameRoom error:", err.message);
      socket.emit("error", "Failed to join CrossZero room");
    }
  });

  /**
   * Join a specific session room
   * Emits: cz:sessionUpdate — current session state
   */
  socket.on("cz:joinSession", async ({ sessionId }) => {
    if (!sessionId) return socket.emit("error", "sessionId is required");

    try {
      socket.join(sessionId);
      console.log(`${socket.id} joined CrossZero session: ${sessionId}`);

      const session = await populateSession(GameSession.findById(sessionId));
      if (session) {
        socket.emit("cz:sessionUpdate", session);
      }
    } catch (err) {
      console.error("cz:joinSession error:", err.message);
      socket.emit("error", "Failed to join session");
    }
  });

  /**
   * Get all recent sessions for a game room
   * Emits: cz:allSessions
   */
  socket.on("cz:getAllSessions", async ({ gameSlug }) => {
    try {
      const game = await Game.findOne({ slug: gameSlug, type: "xo", mode: "pvp" }).notDeleted();
      if (!game) return;

      const sessions = await populateRecentSessions(game._id);

      io.to(gameSlug).emit("cz:sessionsUpdate", sessions);
      io.to(gameSlug).emit("cz:allSessions", sessions);
    } catch (err) {
      console.error("cz:getAllSessions error:", err.message);
    }
  });

  /**
   * Player makes a move
   * Payload: { sessionId, playerId, cellIndex }
   * Emits: cz:sessionUpdate to session room + cz:sessionsUpdate to game room
   */
  socket.on("cz:makeMove", async ({ sessionId, playerId, cellIndex }) => {
    try {
      if (cellIndex === undefined || cellIndex < 0 || cellIndex > 8) {
        return socket.emit("cz:moveError", "Invalid cell index (0–8)");
      }

      const updatedSession = await processMove(sessionId, playerId, cellIndex);

      const populated = await populateSession(GameSession.findById(updatedSession._id));
      const gameSlug = populated.gameId?.slug || "";

      io.to(sessionId).emit("cz:sessionUpdate", populated);

      const sessions = await populateRecentSessions(populated.gameId?._id);
      io.to(gameSlug).emit("cz:sessionsUpdate", sessions);
      io.to(gameSlug).emit("cz:allSessions", sessions);
    } catch (err) {
      console.error("cz:makeMove error:", err.message);
      socket.emit("cz:moveError", err.message);
    }
  });

  socket.on("disconnect", () => {
    console.log(`Client disconnected from CrossZero: ${socket.id}`);
  });
};

module.exports = crosszeroSocket;
