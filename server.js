const http = require("http");
const { Server } = require("socket.io");
const app = require("./src/app");
const env = require("./src/config/env");
const socketHandler = require("./src/socket/socketEvents");

const PORT = env.server.port;

// Create HTTP Server
const server = http.createServer(app);

// Initialize WebSockets
const io = new Server(server, {
  cors: { origin: "*", credentials: true },
});

// WebSocket handlers
socketHandler(io);

module.exports = { server, io };

// Start the Server
server.listen(PORT, "0.0.0.0", () => {
  console.log(`🚀 Server running on port ${PORT}, accessible via LAN`);
});
