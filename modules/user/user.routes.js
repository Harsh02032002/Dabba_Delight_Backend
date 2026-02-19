import express from "express";
import { protect } from "../../middlewares/auth.middleware.js";
import * as userCtrl from "./user.controller.js";
import { handleImageUpload } from "../../middlewares/image.middleware.js";

const router = express.Router();

// Profile
router.get("/me", protect, userCtrl.getProfile);
router.put("/me", protect, userCtrl.updateProfile);
router.patch("/me/avatar", protect, handleImageUpload, userCtrl.uploadAvatar);

// Wishlist
router.post("/wishlist/add", protect, userCtrl.addToWishlist);
router.get("/wishlist", protect, userCtrl.getWishlist);
router.delete("/wishlist/:id", protect, userCtrl.removeFromWishlist);

// Admin routes
router.get("/", protect, userCtrl.getUsers);
router.get("/:id", protect, userCtrl.getUserById);
router.delete("/:id", protect, userCtrl.deleteUser);
router.post("/:id/role", protect, userCtrl.updateRole);

export default router;
