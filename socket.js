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
    if (role === "delivery_partner" && id) socket.join(`delivery_partner_${id}`);
    if (role === "user" && id) socket.join(`user:${id}`);
    
    console.log(`🔌 Socket connected: ${role} ${id || ''}`);
    
    // Delivery partner events
    socket.on("partnerOnline", async () => {
      if (role === "delivery_partner" && id) {
        console.log(`🏃 Delivery partner ${id} is now online`);
        socket.broadcast.emit("partnerStatusUpdate", { partnerId: id, status: "online" });
      }
    });
    
    socket.on("partnerOffline", async () => {
      if (role === "delivery_partner" && id) {
        console.log(`🏃 Delivery partner ${id} is now offline`);
        socket.broadcast.emit("partnerStatusUpdate", { partnerId: id, status: "offline" });
      }
    });
    
    socket.on("acceptOrder", async (data) => {
      if (role === "delivery_partner" && id) {
        const { handleDeliveryResponse } = require('./services/delivery-assignment.service');
        const result = await handleDeliveryResponse(data.orderId, id, 'accepted', io);
        console.log(`✅ Partner ${id} accepted order ${data.orderId}:`, result);
      }
    });
    
    socket.on("rejectOrder", async (data) => {
      if (role === "delivery_partner" && id) {
        const { handleDeliveryResponse } = require('./services/delivery-assignment.service');
        const result = await handleDeliveryResponse(data.orderId, id, 'rejected', io);
        console.log(`❌ Partner ${id} rejected order ${data.orderId}:`, result);
      }
    });
    
    socket.on("locationUpdate", (data) => {
      if (role === "delivery_partner" && id) {
        console.log(`📍 Location update from partner ${id}:`, data.lat, data.lng);
        socket.broadcast.emit("partnerLocationUpdate", { partnerId: id, ...data });
      }
    });
    
    socket.on("disconnect", () => {
      console.log(`🔌 Socket disconnected: ${role} ${id || ''}`);
      if (role === "delivery_partner" && id) {
        socket.broadcast.emit("partnerStatusUpdate", { partnerId: id, status: "offline" });
      }
    });
  });

  return io;
};

export const getIO = () => io;

export default { initSocket, getIO };
