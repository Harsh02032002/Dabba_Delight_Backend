import express from "express";
import { protect } from "../../middlewares/auth.middleware.js";
import * as orderCtrl from "./order.controller.js";

const router = express.Router();

router.get("/", protect, orderCtrl.getOrders);
router.patch("/:id/status", protect, orderCtrl.updateOrderStatus);

export default router;
