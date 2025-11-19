const Game = require("../../../models/Game");
const GameSession = require("../../../models/GameSession");

const eventDuelSocket = (io, socket) => {
  /**
   * Join a game room by gameSlug
   */
  socket.on("joinGameRoom", async (gameSlug) => {
    try {
      const game = await Game.findOne({
        slug: gameSlug,
        mode: "pvp",
        type: "quiz",
      }).notDeleted();
      if (!game) {
        console.warn(`Invalid or non-PvP gameSlug: ${gameSlug}`);
        return socket.emit("error", "Invalid or non-PvP gameSlug");
      }

      socket.join(gameSlug);
      console.log(`${socket.id} joined EventDuel room: ${gameSlug}`);

      // Populate sessions dynamically depending on mode
      const sessions = await GameSession.find({ gameId: game._id })
        .notDeleted()
        .populate(
          game.isTeamMode
            ? [
                { path: "teams.teamId" },
                { path: "teams.players.playerId" },
                { path: "winnerTeamId" },
                { path: "gameId" },
              ]
            : ["players.playerId", "winner", "gameId"]
        )
        .sort({ createdAt: -1 })
        .limit(5);

      socket.emit("pvpSessionsUpdate", sessions);
    } catch (error) {
      console.error("EventDuel joinGameRoom error:", error.message);
      socket.emit("error", "Game room registration failed");
    }
  });

  /**
   * Join a specific session by ID (optional direct join)
   */
  socket.on("joinSession", ({ sessionId }) => {
    if (!sessionId) {
      console.warn(`${socket.id} tried to join without sessionId`);
      return socket.emit("error", "Session ID is required to join");
    }

    socket.join(sessionId);
    console.log(`${socket.id} joined EventDuel session: ${sessionId}`);
  });

  /**
   * Get all sessions for a given gameSlug
   * Emits to all clients in that room: pvpAllSessions
   */
  socket.on("getAllSessions", async ({ gameSlug }) => {
    try {
      const game = await Game.findOne({
        slug: gameSlug,
        mode: "pvp",
        type: "quiz",
      }).notDeleted();
      if (!game) {
        console.warn(`Game not found for slug: ${gameSlug}`);
        return;
      }

      let allSessions;

      if (game.isTeamMode) {
        // Team Mode sessions with full population
        allSessions = await GameSession.find({ gameId: game._id })
          .notDeleted()
          .populate([
            { path: "teams.teamId" },
            { path: "teams.players.playerId" },
            { path: "winnerTeamId" },
            { path: "gameId" },
          ])
          .sort({ createdAt: -1 })
          .limit(5);
      } else {
        // PvP sessions
        allSessions = await GameSession.find({ gameId: game._id })
          .notDeleted()
          .populate("players.playerId winner gameId")
          .sort({ createdAt: -1 })
          .limit(5);
      }

      io.to(game.slug).emit("pvpAllSessions", allSessions);
      console.log(
        `Emitted ${allSessions.length} session(s) for ${gameSlug} (${
          game.isTeamMode ? "Team" : "PvP"
        } mode)`
      );
    } catch (err) {
      console.error("getAllSessions error:", err.message);
      socket.emit("error", "Failed to fetch sessions");
    }
  });

  /**
   * Cleanup on disconnect
   */
  socket.on("disconnect", () => {
    console.log(`Client disconnected from EventDuel: ${socket.id}`);
  });
};

module.exports = eventDuelSocket;
