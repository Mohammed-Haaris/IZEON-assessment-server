import { Request, Response, NextFunction } from "express";
import jwt from "jsonwebtoken";
import prisma from "../lib/prisma";

const JWT_SECRET = process.env.JWT_SECRET || "izeon_super_secret_jwt_key_2026";

export interface AuthenticatedUser {
  id: string;
  email: string;
  role: "ADMIN" | "STUDENT";
  status: "PENDING_APPROVAL" | "APPROVED" | "REJECTED";
  name: string;
  position?: string | null;
}

export interface AuthRequest extends Request {
  user?: AuthenticatedUser;
}

export const authenticateToken = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction
): Promise<void> => {
  const authHeader = req.headers["authorization"];
  const token = authHeader && authHeader.split(" ")[1];

  if (!token) {
    res.status(401).json({ message: "Access token required" });
    return;
  }

  try {
    const decoded = jwt.verify(token, JWT_SECRET) as { id: string };
    const user: any = await prisma.user.findUnique({
      where: { id: decoded.id },
    });

    if (!user) {
      res.status(401).json({ message: "User account not found" });
      return;
    }

    req.user = {
      id: user.id,
      email: user.email,
      role: user.role,
      status: user.status,
      name: user.name,
      position: (user as any)?.position ?? null,
    };
    next();
  } catch (error) {
    res.status(403).json({ message: "Invalid or expired token" });
  }
};

export const requireAdmin = (
  req: AuthRequest,
  res: Response,
  next: NextFunction
): void => {
  if (!req.user || req.user.role !== "ADMIN") {
    res.status(403).json({ message: "Admin access required" });
    return;
  }
  next();
};

export const requireApprovedStudent = (
  req: AuthRequest,
  res: Response,
  next: NextFunction
): void => {
  if (!req.user) {
    res.status(401).json({ message: "Unauthorized" });
    return;
  }

  if (req.user.role === "ADMIN") {
    next();
    return;
  }

  if (req.user.status !== "APPROVED") {
    res.status(403).json({
      message:
        req.user.status === "PENDING_APPROVAL"
          ? "Your account is pending admin approval."
          : "Your account has been rejected by the administrator.",
      status: req.user.status,
    });
    return;
  }

  next();
};
