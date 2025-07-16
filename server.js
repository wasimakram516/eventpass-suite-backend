const http = require("http");
const { Server } = require("socket.io");
const app = require("./src/app");
const env = require("./src/config/env");
const mosaicWallSocketEvents = require("./src/socket/modules/mosaicWallSocketEvents");
const MosaicWallDisplayMediaController = require("./src/controllers/mosaicwall/displayMediaController"); 

const PORT = env.server.port;

// Create HTTP Server
const server = http.createServer(app);

// Initialize WebSockets
const io = new Server(server, {
  cors: { origin: "*", credentials: true },
});

// WebSocket handlers
mosaicWallSocketEvents(io);

// Set io in displayMediaController to enable emitMediaUpdate()
MosaicWallDisplayMediaController.setSocketIo(io);

module.exports = { server, io };

// Start the Server
server.listen(PORT, "0.0.0.0", () => {
  console.log(`🚀 Server running on port ${PORT}, accessible via LAN`);
});
