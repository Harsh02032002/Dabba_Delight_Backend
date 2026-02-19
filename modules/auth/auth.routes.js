import express from "express";
import { register, login, getMe, deleteAccount } from "./auth.controller.js";
import { protect } from "../../middlewares/auth.middleware.js";

const router = express.Router();

// Public
router.post("/register", register);
router.post("/login", login);

// Protected
router.get("/me", protect, getMe);
router.delete("/delete-account", protect, deleteAccount);

export default router;
