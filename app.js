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
import path from "path";

const app = express();
app.get("/", (req, res) => {
  res.send("Dabba Nation Backend Running 🚀");
});


// ------------------ CORS SETUP ------------------
app.use(
  cors({
    origin: [
      "http://localhost:8080", // tera frontend port (jo tune bola)
      "http://localhost:5173", // default Vite port (safety ke liye)
      "http://localhost:3000", // agar kabhi Create React App use kiya to
      "http://56.228.4.127",
    ],
    credentials: true, // cookies / auth headers ke liye
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

// Static files (uploads folder)
app.use("/uploads", express.static(path.join(process.cwd(), "uploads")));

export default app;
