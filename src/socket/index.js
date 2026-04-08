const memorywallSocket = require("./modules/memorywall/memorywallSocket");
const eventDuelSocket = require("./modules/eventduel/eventDuelSocket");
const crosszeroSocket = require("./modules/crosszero/crosszeroSocket");
const { dashboardSocket } = require("./dashboardSocket");

const socketHandler = (io) => {
  io.on("connection", (socket) => {
    console.log(`🔌 New client connected: ${socket.id}`);

    memorywallSocket(io, socket);
    eventDuelSocket(io, socket);
    crosszeroSocket(io, socket);
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
