let io;

const setSocketIo = (socketIoInstance) => {
  io = socketIoInstance;
};

const emitUpdate = async (event, data) => {
  try {
    if (!io) throw new Error("Socket.io not initialized");
    console.log(`📢 Global emit: ${event}`);
    io.emit(event, data);
  } catch (err) {
    console.error(`❌ emitUpdate failed: ${err.message}`);
  }
};

const emitToRoom = async (room, event, data) => {
  try {
    if (!io) throw new Error("Socket.io not initialized");
    console.log(`📡 Emitting to room: ${room} → ${event}`);
    io.to(room).emit(event, data);
  } catch (err) {
    console.error(`❌ emitToRoom failed: ${err.message}`);
  }
};

module.exports = {
  setSocketIo,
  emitUpdate,
  emitToRoom,
};
