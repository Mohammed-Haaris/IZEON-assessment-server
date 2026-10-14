/** @format */

import express, { Application, Request, Response } from "express";
import http from "http";
import cors from "cors";
import dotenv from "dotenv";
import compression from "compression";
import rateLimit from "express-rate-limit";
import { Server as SocketIOServer } from "socket.io";

import authRoutes from "./src/routes/auth.routes";
import adminRoutes from "./src/routes/admin.routes";
import assessmentRoutes from "./src/routes/assessment.routes";
import { setupProctorSocket } from "./src/socket/proctorSocket";
import { seedDefaultData } from "./src/lib/seed";
import prisma from "./src/lib/prisma";

dotenv.config();

const app: Application = express();
const PORT = process.env.PORT || 5000;

// Security & Performance optimizations
app.disable("x-powered-by");

// Compress HTTP responses (reduces JSON payload size by 70-80% for 1000 concurrent students)
app.use(compression());

// Enable CORS
app.use(
  cors({
    origin: "*",
    methods: ["GET", "POST", "PATCH", "DELETE", "PUT", "OPTIONS"],
    allowedHeaders: ["Content-Type", "Authorization"],
  })
);

// High-capacity JSON parser
app.use(express.json({ limit: "10mb" }));

// General Rate Limiter - generous enough for 1000 students, prevents malicious DDoS
const generalLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 3000, // max 3000 requests per 15 mins per IP
  standardHeaders: true,
  legacyHeaders: false,
  message: { message: "Too many requests from this IP, please try again later." },
});
app.use("/api", generalLimiter);

// Specific Auth Limiter to prevent brute force while allowing campus NATs/shared IPs
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 300,
  standardHeaders: true,
  legacyHeaders: false,
  message: { message: "Too many authentication attempts, please try again shortly." },
});
app.use("/api/auth/login", authLimiter);
app.use("/api/auth/register", authLimiter);

// Mount API routes
app.use("/api/auth", authRoutes);
app.use("/api/admin", adminRoutes);
app.use("/api/assessment", assessmentRoutes);

// Health check
app.get("/api/health", (req: Request, res: Response) => {
  res.json({
    status: "healthy",
    timestamp: new Date(),
    uptime: process.uptime(),
    memoryUsage: process.memoryUsage(),
  });
});

// Create HTTP and WebSocket servers with 1000-connection tuning
const server = http.createServer(app);
const io = new SocketIOServer(server, {
  cors: {
    origin: "*",
    methods: ["GET", "POST"],
  },
  pingInterval: 25000,
  pingTimeout: 60000,
  transports: ["websocket", "polling"],
  maxHttpBufferSize: 1e6, // 1MB
});

// Initialize proctoring sockets
app.set("io", io);
setupProctorSocket(io);

// Start server and seed default data
server.listen(PORT, async () => {
  console.log(`IZEON Assessment Server running on http://localhost:${PORT}`);
  console.log(`Server tuned for 1000+ concurrent student sessions`);
  await seedDefaultData();
});

// Graceful shutdown
const shutdown = async (signal: string) => {
  console.log(`Received ${signal}. Shutting down gracefully...`);
  server.close(async () => {
    try {
      await prisma.$disconnect();
      console.log("Database disconnected. Server closed cleanly.");
      process.exit(0);
    } catch (err) {
      console.error("Error during graceful shutdown:", err);
      process.exit(1);
    }
  });
};

process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT", () => shutdown("SIGINT"));
