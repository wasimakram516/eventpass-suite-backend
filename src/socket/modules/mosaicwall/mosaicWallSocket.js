const WallConfig = require("../../../models/WallConfig");
const DisplayMedia = require("../../../models/DisplayMedia");

const mosaicWallSocket = (io, socket) => {
  socket.on("register", async (wallSlug) => {
    try {
      const wall = await WallConfig.findOne({ slug: wallSlug });
      if (!wall) {
        return socket.emit("error", "Invalid wall slug");
      }

      socket.join(wallSlug);
      console.log(`🧱 ${socket.id} joined MosaicWall room: ${wallSlug}`);

      const media = await DisplayMedia.find({ wall: wall._id }).sort({ createdAt: -1 });
      socket.emit("mediaUpdate", media);
    } catch (error) {
      console.error("❌ mosaicWall register error:", error.message);
      socket.emit("error", "Wall registration failed");
    }
  });
};

module.exports = mosaicWallSocket;
