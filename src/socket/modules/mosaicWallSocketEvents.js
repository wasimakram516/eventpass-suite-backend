const DisplayMedia = require("../../models/DisplayMedia");
const WallConfig = require("../../models/WallConfig");

const socketHandler = (io) => {
  io.on("connection", async (socket) => {
    console.log(`New client attempted to connect: ${socket.id}`);

    socket.on("connect_error", (err) => {
      console.error("❌ Socket connection error:", err.message);
    });

    // Register listener for a specific wallSlug
    socket.on("register", async (wallSlug) => {
      try {
        const wall = await WallConfig.findOne({ slug: wallSlug });
        if (!wall) {
          return socket.emit("error", "Invalid wall slug");
        }

        // Join a room for that wall
        socket.join(wallSlug);
        socket.wallSlug = wallSlug;
        console.log(`Client ${socket.id} joined room: ${wallSlug}`);

        // Send initial media for this wall only
        const media = await DisplayMedia.find({ wall: wall._id }).sort({ createdAt: -1 });
        socket.emit("mediaUpdate", media);
      } catch (error) {
        console.error("❌ Failed to register socket:", error);
      }
    });

    socket.on("disconnect", (reason) => {
      console.log(`❌ Client disconnected: ${socket.id} - Reason: ${reason}`);
    });
  });
};

module.exports = socketHandler;
