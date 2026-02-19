import mongoose from "mongoose";
import dns from "dns";
import { ENV } from "./env.js";

// If Node is using a local resolver (127.0.0.1) that is not responding,
// SRV lookups (used by mongodb+srv) will fail with ECONNREFUSED.
// Fall back to public DNS servers so the driver can resolve Atlas SRV records.
const currentServers = dns.getServers();
if (currentServers && currentServers.includes("127.0.0.1")) {
  console.warn(
    "Local DNS server 127.0.0.1 detected — switching to public DNS for SRV lookups",
  );
  dns.setServers(["8.8.8.8", "8.8.4.4"]);
}

export const connectDB = async () => {
  try {
    await mongoose.connect(ENV.MONGO_URI);
    console.log("MongoDB Connected");
  } catch (err) {
    console.error("DB Error", err.message);
    process.exit(1);
  }
};
