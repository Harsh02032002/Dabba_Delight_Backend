import { ENV } from "./config/env.js";
import http from "http";
import app from "./app.js";
import { connectDB } from "./config/db.js";
import { initSocket } from "./socket.js";

connectDB();

const server = http.createServer(app);
initSocket(server);

server.listen(ENV.PORT, () =>
  console.log(`Server running on port ${ENV.PORT}`),
);
