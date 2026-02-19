import express from "express";
import { protect } from "../../middlewares/auth.middleware.js";
import {
  getNotifications,
  markAsRead,
  markAllAsRead,
  deleteNotification,
} from "./notification.controller.js";

const router = express.Router();

// Get current user's notifications
router.get("/", protect, getNotifications);

// Mark a notification as read
router.patch("/:id/read", protect, markAsRead);

// Mark all as read
router.patch("/mark-all-read", protect, markAllAsRead);

// Delete a notification
router.delete("/:id", protect, deleteNotification);

export default router;
