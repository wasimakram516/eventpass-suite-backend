const mosaicWallSocket = require("./modules/mosaicwall/mosaicWallSocket");
const eventDuelSocket = require("./modules/eventduel/eventDuelSocket");
const { dashboardSocket } = require("./dashboardSocket");

const socketHandler = (io) => {
  io.on("connection", (socket) => {
    console.log(`🔌 New client connected: ${socket.id}`);

    mosaicWallSocket(io, socket);
    eventDuelSocket(io, socket);
    dashboardSocket(io, socket);

    socket.on("ping", () => {
      socket.emit("pong");
    });

    socket.on("disconnect", () => {
      console.log(`❌ Client disconnected: ${socket.id}`);
    });
  });
};

module.exports = socketHandler;
