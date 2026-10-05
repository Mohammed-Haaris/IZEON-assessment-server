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
      tenthMark,
      twelfthMark,
      cgpa,
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
        tenthMark,
        twelfthMark,
        cgpa,
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
        tenthMark: true,
        twelfthMark: true,
        cgpa: true,
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
        tenthMark: true,
        twelfthMark: true,
        cgpa: true,
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

// ==========================================
// ADMIN PASSWORD RESET ENDPOINTS (ADMIN ONLY)
// ==========================================

const ADMIN_MASTER_RECOVERY_KEY =
  process.env.ADMIN_RECOVERY_KEY || "IZEON_ADMIN_SECURE_RECOVERY_2026";

// Helper to mask email for UI display (e.g. ad***n@izeon.com)
function maskEmail(email: string): string {
  const parts = email.split("@");
  if (parts.length !== 2) return email;
  const [local, domain] = parts;
  if (local.length <= 2) return `${local[0]}*@${domain}`;
  return `${local.substring(0, 2)}***${local[local.length - 1]}@${domain}`;
}

// 1. Request Reset Passcode (Admin Only)
router.post("/admin/forgot-password/request", async (req, res: Response) => {
  try {
    const { email } = req.body;

    if (!email || typeof email !== "string" || !email.trim()) {
      res.status(400).json({ message: "Administrator email address is required." });
      return;
    }

    const cleanEmail = email.toLowerCase().trim();
    const user = await prisma.user.findUnique({
      where: { email: cleanEmail },
      select: { id: true, name: true, email: true, role: true },
    });

    if (!user) {
      res.status(404).json({
        message: "No administrator account was found with this email address.",
      });
      return;
    }

    // STRICT CHECK: Only ADMIN role is permitted
    if (user.role !== "ADMIN") {
      res.status(403).json({
        message:
          "Access Denied: Password reset is strictly restricted to Administrator accounts only. Student candidates cannot reset credentials via this portal. Please contact the test administrator.",
      });
      return;
    }

    // Generate secure 6-digit numeric passcode
    const passcode = Math.floor(100000 + Math.random() * 900000).toString();
    const expiresAt = new Date(Date.now() + 15 * 60 * 1000); // 15 minutes

    // Save passcode & expiry
    await (prisma.user as any).update({
      where: { id: user.id },
      data: {
        resetToken: passcode,
        resetTokenExpiry: expiresAt,
      },
    });

    // Console logging for instant server inspection
    console.log(`\n======================================================`);
    console.log(`🔑 [IZEON ADMIN SECURITY] PASSWORD RESET PASSCODE`);
    console.log(`👤 Admin Name:       ${user.name}`);
    console.log(`📧 Admin Email:      ${user.email}`);
    console.log(`🔢 6-Digit Passcode: ${passcode}`);
    console.log(`⏰ Expiration:       15 minutes (${expiresAt.toLocaleTimeString()})`);
    console.log(`======================================================\n`);

    res.json({
      message:
        "Security verification passcode generated successfully. Please enter the passcode to reset your password.",
      email: user.email,
      maskedEmail: maskEmail(user.email),
      devPasscode: passcode, // Returned for dev/local demo convenience when SMTP is not configured
    });
  } catch (error: any) {
    console.error("Admin forgot-password request error:", error);
    res.status(500).json({ message: "Internal server error", error: error.message });
  }
});

// 2. Verify Passcode (Admin Only)
router.post("/admin/forgot-password/verify-code", async (req, res: Response) => {
  try {
    const { email, code } = req.body;

    if (!email || !code) {
      res.status(400).json({ message: "Email and verification code are required." });
      return;
    }

    const cleanEmail = email.toLowerCase().trim();
    const user: any = await (prisma.user as any).findUnique({
      where: { email: cleanEmail },
      select: { id: true, role: true, resetToken: true, resetTokenExpiry: true },
    });

    if (!user || user.role !== "ADMIN") {
      res.status(403).json({
        message: "Access Denied: Password reset is strictly restricted to Administrator accounts.",
      });
      return;
    }

    const cleanCode = code.toString().trim();
    const isCodeValid =
      user.resetToken &&
      user.resetToken === cleanCode &&
      user.resetTokenExpiry &&
      new Date(user.resetTokenExpiry) > new Date();

    if (!isCodeValid) {
      res.status(400).json({
        message: "Invalid or expired verification passcode. Please request a new passcode.",
      });
      return;
    }

    res.json({
      message: "Security passcode verified successfully. You may now enter your new password.",
      verified: true,
    });
  } catch (error: any) {
    console.error("Admin verify-code error:", error);
    res.status(500).json({ message: "Internal server error", error: error.message });
  }
});

// 3. Reset Admin Password (Admin Only)
router.post("/admin/forgot-password/reset", async (req, res: Response) => {
  try {
    const { email, newPassword, confirmPassword, code, recoveryKey } = req.body;

    if (!email || !newPassword) {
      res.status(400).json({ message: "Email and new password are required." });
      return;
    }

    if (newPassword.length < 6) {
      res.status(400).json({
        message: "New password must be at least 6 characters long.",
      });
      return;
    }

    if (confirmPassword && newPassword !== confirmPassword) {
      res.status(400).json({
        message: "New password and confirmation password do not match.",
      });
      return;
    }

    const cleanEmail = email.toLowerCase().trim();
    const user: any = await (prisma.user as any).findUnique({
      where: { email: cleanEmail },
      select: {
        id: true,
        name: true,
        email: true,
        role: true,
        resetToken: true,
        resetTokenExpiry: true,
      },
    });

    if (!user) {
      res.status(404).json({ message: "No administrator account found with this email." });
      return;
    }

    // STRICT CHECK: Only ADMIN role is permitted
    if (user.role !== "ADMIN") {
      res.status(403).json({
        message:
          "Access Denied: Password reset is strictly restricted to Administrator accounts only. Student credentials cannot be reset via this portal.",
      });
      return;
    }

    // Authorize via Master Recovery Key OR 6-digit Passcode
    let isAuthorized = false;

    if (recoveryKey && typeof recoveryKey === "string" && recoveryKey.trim() === ADMIN_MASTER_RECOVERY_KEY) {
      isAuthorized = true;
    } else if (code) {
      const cleanCode = code.toString().trim();
      if (
        user.resetToken &&
        user.resetToken === cleanCode &&
        user.resetTokenExpiry &&
        new Date(user.resetTokenExpiry) > new Date()
      ) {
        isAuthorized = true;
      }
    }

    if (!isAuthorized) {
      res.status(400).json({
        message:
          "Authentication failed: Invalid or expired verification passcode or Master Admin Recovery Key.",
      });
      return;
    }

    // Hash new password and clear reset token
    const hashedPassword = await bcrypt.hash(newPassword, 10);

    await (prisma.user as any).update({
      where: { id: user.id },
      data: {
        password: hashedPassword,
        resetToken: null,
        resetTokenExpiry: null,
      },
    });

    console.log(`\n======================================================`);
    console.log(`✅ [IZEON ADMIN SECURITY] PASSWORD RESET SUCCESSFUL`);
    console.log(`👤 Admin: ${user.name} (${user.email})`);
    console.log(`🕒 Timestamp: ${new Date().toISOString()}`);
    console.log(`======================================================\n`);

    res.json({
      message:
        "Administrator password reset successfully! You can now sign in with your new credentials.",
      email: user.email,
    });
  } catch (error: any) {
    console.error("Admin reset password error:", error);
    res.status(500).json({ message: "Internal server error", error: error.message });
  }
});

export default router;

