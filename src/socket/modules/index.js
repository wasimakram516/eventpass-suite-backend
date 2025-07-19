const mosaicWallSocket = require("./mosaicwall/mosaicWallSocket");
const eventDuelSocket = require("./eventduel/eventDuelSocket");

const socketHandler = (io) => {
  io.on("connection", (socket) => {
    console.log(`🔌 New client connected: ${socket.id}`);

    mosaicWallSocket(io, socket);
    eventDuelSocket(io, socket);

    socket.on("ping", () => {
      socket.emit("pong");
    });

    socket.on("disconnect", () => {
      console.log(`❌ Client disconnected: ${socket.id}`);
    });
  });
};

module.exports = socketHandler;
