import { Router, Response } from "express";
import bcrypt from "bcrypt";
import jwt from "jsonwebtoken";
import prisma from "../lib/prisma";
import { authenticateToken, AuthRequest } from "../middleware/auth.middleware";

const router = Router();
const JWT_SECRET = process.env.JWT_SECRET || "izeon_super_secret_jwt_key_2026";

// Register
router.post("/register", async (req, res: Response) => {
  try {
    const {
      name,
      email,
      password,
      college,
      department,
      rollNumber,
      position,
      dob,
      mobileNumber,
    } = req.body;

    if (!name || !email || !password) {
      res.status(400).json({ message: "Name, email, and password are required" });
      return;
    }

    const existingUser = await prisma.user.findUnique({ where: { email } });
    if (existingUser) {
      res.status(409).json({ message: "User with this email already exists" });
      return;
    }

    const hashedPassword = await bcrypt.hash(password, 10);
    // Public registrations are for STUDENTs with direct assessment access
    const assignedRole = "STUDENT";
    const assignedStatus = "APPROVED";

    const user = await prisma.user.create({
      data: {
        name,
        email,
        password: hashedPassword,
        college,
        department,
        rollNumber,
        position,
        dob,
        mobileNumber,
        role: assignedRole,
        status: assignedStatus,
      },
      select: {
        id: true,
        name: true,
        email: true,
        college: true,
        department: true,
        rollNumber: true,
        position: true,
        dob: true,
        mobileNumber: true,
        role: true,
        status: true,
        createdAt: true,
      },
    });

    const token = jwt.sign({ id: user.id, role: user.role }, JWT_SECRET, {
      expiresIn: "7d",
    });

    res.status(201).json({
      message:
        user.role === "STUDENT"
          ? "Account registered successfully! You can start your assessment immediately."
          : "Admin account registered successfully!",
      user,
      token,
    });
  } catch (error: any) {
    console.error("Register error:", error);
    res.status(500).json({ message: "Internal server error", error: error.message });
  }
});

// Login
router.post("/login", async (req, res: Response) => {
  try {
    const { email, password } = req.body;

    if (!email || !password) {
      res.status(400).json({ message: "Email and password are required" });
      return;
    }

    const user = await prisma.user.findUnique({ where: { email } });
    if (!user) {
      res.status(401).json({ message: "Invalid email or password" });
      return;
    }

    const isMatch = await bcrypt.compare(password, user.password);
    if (!isMatch) {
      res.status(401).json({ message: "Invalid email or password" });
      return;
    }

    if (user.role === "STUDENT" && user.status === "REJECTED") {
      res.status(403).json({
        message: "Your registration was rejected by the administrator.",
        status: user.status,
      });
      return;
    }

    // Auto-activate any student account that was previously PENDING_APPROVAL
    if (user.role === "STUDENT" && user.status === "PENDING_APPROVAL") {
      await prisma.user.update({
        where: { id: user.id },
        data: { status: "APPROVED" },
      });
      user.status = "APPROVED";
    }

    const token = jwt.sign({ id: user.id, role: user.role }, JWT_SECRET, {
      expiresIn: "7d",
    });

    res.json({
      message: "Logged in successfully",
      token,
      user: {
        id: user.id,
        name: user.name,
        email: user.email,
        college: user.college,
        role: user.role,
        status: user.status,
      },
    });
  } catch (error: any) {
    console.error("Login error:", error);
    res.status(500).json({ message: "Internal server error", error: error.message });
  }
});

// Get current profile
router.get("/me", authenticateToken, async (req: AuthRequest, res: Response) => {
  try {
    const user = await prisma.user.findUnique({
      where: { id: req.user!.id },
      select: {
        id: true,
        name: true,
        email: true,
        college: true,
        department: true,
        rollNumber: true,
        position: true,
        dob: true,
        mobileNumber: true,
        role: true,
        status: true,
        createdAt: true,
      },
    });

    if (!user) {
      res.status(404).json({ message: "User not found" });
      return;
    }

    // Auto-activate if previously pending
    if (user.role === "STUDENT" && user.status === "PENDING_APPROVAL") {
      await prisma.user.update({
        where: { id: user.id },
        data: { status: "APPROVED" },
      });
      user.status = "APPROVED";
    }

    res.json({ user });
  } catch (error: any) {
    res.status(500).json({ message: "Internal server error", error: error.message });
  }
});

export default router;
