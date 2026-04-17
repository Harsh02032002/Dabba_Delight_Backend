import express from "express";
import cors from "cors"; // ← yeh line add kar
import authRoutes from "./modules/auth/auth.routes.js";
import productRoutes from "./modules/product/product.routes.js";
import cartRoutes from "./modules/cart/cart.routes.js";
import sellerRoutes from "./modules/seller/seller.routes.js";
import orderRoutes from "./modules/order/order.routes.js";
import userRoutes from "./modules/user/user.routes.js";
import userPublicRoutes from "./modules/user/user.public.routes.js";
import notificationRoutes from "./modules/notification/notification.routes.js";
import paymentRoutes from "./modules/payment/payment.routes.js";
import adminRoutes from "./modules/admin/admin.routes.js";
import subscriptionRoutes from "./routes/subscription.routes.js";
import walletRoutes from "./routes/wallet.routes.js";
import path from "path";

const app = express();
app.get("/", (req, res) => {
  res.send("Dabba Nation Backend Running 🚀");
});


// ------------------ CORS SETUP ------------------
app.use(
  cors({
    origin: [
      "http://localhost:8080",
      "http://localhost:8083", // Rider app port
      "http://localhost:5173",
      "http://localhost:3000",
      "http://56.228.4.127",
      "https://dabbanation.in",
      "https://www.dabbanation.in",
    ],
    credentials: true,
    methods: ["GET", "POST", "PUT", "DELETE", "PATCH", "OPTIONS"],
    allowedHeaders: ["Content-Type", "Authorization"],
  }),
);

// Yeh OPTIONS requests ko handle karega (preflight)
app.options("/*all", cors());

// ------------------ Normal middleware ------------------
app.use(express.json());

// ------------------ Routes ------------------
app.use("/api/auth", authRoutes);
app.use("/api/products", productRoutes);
app.use("/api/cart", cartRoutes);
app.use("/api/seller", sellerRoutes);
app.use("/api/orders", orderRoutes);
app.use("/api/users", userRoutes);
// Public user endpoints used by frontend (singular path used in client)
app.use("/api/user", userPublicRoutes);
// User notifications
app.use("/api/notifications", notificationRoutes);
// Payment (Stripe & Razorpay)
app.use("/api/payments", paymentRoutes);
app.use("/api/admin", adminRoutes);
// Subscription routes
app.use("/api/subscriptions", subscriptionRoutes);
// Wallet routes
app.use("/api/wallet", walletRoutes);
// Static files (uploads folder)
app.use("/uploads", express.static(path.join(process.cwd(), "uploads")));

export default app;
