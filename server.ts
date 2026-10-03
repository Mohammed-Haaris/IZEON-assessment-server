/** @format */

import express, { Application, Request, Response } from "express";
import http from "http";
import cors from "cors";
import dotenv from "dotenv";
import { Server as SocketIOServer } from "socket.io";

import authRoutes from "./src/routes/auth.routes";
import adminRoutes from "./src/routes/admin.routes";
import assessmentRoutes from "./src/routes/assessment.routes";
import { setupProctorSocket } from "./src/socket/proctorSocket";
import { seedDefaultData } from "./src/lib/seed";

dotenv.config();

const app: Application = express();
const PORT = process.env.PORT || 5000;

// Enable CORS & JSON parsing
app.use(
  cors({
    origin: "*",
    methods: ["GET", "POST", "PATCH", "DELETE", "PUT", "OPTIONS"],
    allowedHeaders: ["Content-Type", "Authorization"],
  })
);
app.use(express.json());

// Mount API routes
app.use("/api/auth", authRoutes);
app.use("/api/admin", adminRoutes);
app.use("/api/assessment", assessmentRoutes);

// Health check
app.get("/api/health", (req: Request, res: Response) => {
  res.json({ status: "healthy", timestamp: new Date() });
});

// Create HTTP and WebSocket servers
const server = http.createServer(app);
const io = new SocketIOServer(server, {
  cors: {
    origin: "*",
    methods: ["GET", "POST"],
  },
});

// Initialize proctoring sockets
app.set("io", io);
setupProctorSocket(io);

// Start server and seed default data
server.listen(PORT, async () => {
  console.log(`IZEON Assessment Server running on http://localhost:${PORT}`);
  await seedDefaultData();
});
