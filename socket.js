import { Server } from "socket.io";
import jwt from "jsonwebtoken";

let io = null;

export const initSocket = (server) => {
  if (io) return io;
  io = new Server(server, {
    cors: { origin: process.env.SOCKET_IO_ORIGIN || "*" },
  });

  // Middleware: attach user from JWT
  io.use((socket, next) => {
    try {
      const token = socket.handshake.auth?.token;
      if (!token) return next(new Error("Authentication error"));
      const decoded = jwt.verify(token, process.env.JWT_SECRET);
      socket.user = decoded;
      return next();
    } catch (err) {
      return next(new Error("Authentication error"));
    }
  });

  io.on("connection", (socket) => {
    const { role, id } = socket.user || {};
    if (role) socket.join(role);
    if (role === "seller" && id) socket.join(`seller:${id}`);
    socket.on("disconnect", () => console.log("Socket disconnected"));
  });

  return io;
};

export const getIO = () => io;

export default { initSocket, getIO };
