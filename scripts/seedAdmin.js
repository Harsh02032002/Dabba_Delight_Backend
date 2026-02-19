import { connectDB } from "../config/db.js";
import User from "../modules/user/user.model.js";
import bcrypt from "bcryptjs";

async function seedAdmin() {
  try {
    await connectDB();

    const email = "admin@dd.com";
    const plain = "123456";
    const hashed = await bcrypt.hash(plain, 10);

    const update = {
      name: "Admin",
      email,
      password: hashed,
      role: "admin",
    };

    const user = await User.findOneAndUpdate(
      { email },
      update,
      { upsert: true, new: true, setDefaultsOnInsert: true },
    );

    console.log("Admin user created/updated:", user.email, user.role);
    process.exit(0);
  } catch (err) {
    console.error("Seeding admin failed:", err);
    process.exit(1);
  }
}

seedAdmin();
