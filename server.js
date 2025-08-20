const http = require("http");
const { Server } = require("socket.io");
const app = require("./src/app");
const env = require("./src/config/env");
const registerAllSocketModules = require("./src/socket/modules");
const { setSocketIo } = require("./src/utils/socketUtils");

const PORT = env.server.port;

// Create HTTP Server
const server = http.createServer(app);

// Initialize WebSockets
const io = new Server(server, {
  cors: { origin: "*", credentials: true },
});

setSocketIo(io);
registerAllSocketModules(io);

module.exports = { server, io };
 
// Start the Server
server.listen(PORT, "0.0.0.0", () => {
  console.log(`🚀 Server running on port ${PORT}, accessible via LAN`);
});
