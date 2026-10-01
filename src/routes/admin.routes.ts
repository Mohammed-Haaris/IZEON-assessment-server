import { Router, Response } from "express";
import bcrypt from "bcrypt";
import prisma from "../lib/prisma";
import { authenticateToken, requireAdmin, AuthRequest } from "../middleware/auth.middleware";

const router = Router();

// Protect all admin routes
router.use(authenticateToken);
router.use(requireAdmin);

// 1. Get all students (optionally filter by status)
router.get("/students", async (req: AuthRequest, res: Response) => {
  try {
    const { status } = req.query;
    const where: any = { role: "STUDENT" };
    if (status && typeof status === "string") {
      where.status = status;
    }

    const students = await prisma.user.findMany({
      where,
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
        status: true,
        createdAt: true,
        _count: {
          select: { attempts: true },
        },
      },
      orderBy: { createdAt: "desc" },
    });

    res.json({ students });
  } catch (error: any) {
    console.error("Fetch students error:", error);
    res.status(500).json({ message: "Internal server error", error: error.message });
  }
});

// 2. Approve or Reject a student
router.patch("/students/:id/status", async (req: AuthRequest, res: Response) => {
  try {
    const id = req.params.id as string;
    const { status } = req.body;

    if (!["APPROVED", "REJECTED", "PENDING_APPROVAL"].includes(status)) {
      res.status(400).json({ message: "Invalid status value" });
      return;
    }

    const updatedStudent = await prisma.user.update({
      where: { id },
      data: { status },
      select: {
        id: true,
        name: true,
        email: true,
        college: true,
        status: true,
      },
    });

    res.json({
      message: `Student registration has been updated to ${status}.`,
      student: updatedStudent,
    });
  } catch (error: any) {
    console.error("Update student status error:", error);
    res.status(500).json({ message: "Failed to update status", error: error.message });
  }
});

// 3. Get all assessments
router.get("/assessments", async (req: AuthRequest, res: Response) => {
  try {
    const assessments = await prisma.assessment.findMany({
      include: {
        _count: {
          select: {
            questions: true,
            attempts: true,
          },
        },
      },
      orderBy: { createdAt: "desc" },
    });

    res.json({ assessments });
  } catch (error: any) {
    res.status(500).json({ message: "Internal server error", error: error.message });
  }
});

// 4. Create an assessment
router.post("/assessments", async (req: AuthRequest, res: Response) => {
  try {
    const {
      title,
      description,
      durationR1 = 30,
      durationR2 = 45,
      passingScore = 60,
      isActive = true,
    } = req.body;

    if (!title) {
      res.status(400).json({ message: "Assessment title is required" });
      return;
    }

    const assessment = await prisma.assessment.create({
      data: {
        title,
        description,
        durationR1: Number(durationR1),
        durationR2: Number(durationR2),
        passingScore: Number(passingScore),
        isActive: Boolean(isActive),
      },
    });

    res.status(201).json({ message: "Assessment created successfully", assessment });
  } catch (error: any) {
    res.status(500).json({ message: "Failed to create assessment", error: error.message });
  }
});

// 5. Get questions for an assessment
router.get("/assessments/:id/questions", async (req: AuthRequest, res: Response) => {
  try {
    const id = req.params.id as string;
    const questions = await prisma.question.findMany({
      where: { assessmentId: id },
      orderBy: { createdAt: "asc" },
    });

    res.json({ questions });
  } catch (error: any) {
    res.status(500).json({ message: "Internal server error", error: error.message });
  }
});

// 6. Add a question to an assessment
router.post("/assessments/:id/questions", async (req: AuthRequest, res: Response) => {
  try {
    const id = req.params.id as string;
    const {
      round,
      category,
      targetRole = "ALL",
      title,
      content,
      options,
      correctAnswer,
      points = 1,
      starterCode,
      testCases,
    } = req.body;

    if (!round || !category || !title || !content) {
      res.status(400).json({ message: "Round, category, title, and content are required" });
      return;
    }

    const question = await prisma.question.create({
      data: {
        assessmentId: id,
        round,
        category,
        targetRole: targetRole || "ALL",
        title,
        content,
        options: options ? (typeof options === "string" ? JSON.parse(options) : options) : null,
        correctAnswer,
        points: Number(points),
        starterCode: starterCode ? (typeof starterCode === "string" ? JSON.parse(starterCode) : starterCode) : null,
        testCases: testCases ? (typeof testCases === "string" ? JSON.parse(testCases) : testCases) : null,
      },
    });

    res.status(201).json({ message: "Question added successfully", question });
  } catch (error: any) {
    console.error("Add question error:", error);
    res.status(500).json({ message: "Failed to add question", error: error.message });
  }
});

// 7. Delete question
router.delete("/questions/:id", async (req: AuthRequest, res: Response) => {
  try {
    const id = req.params.id as string;
    await prisma.question.delete({ where: { id } });
    res.json({ message: "Question deleted successfully" });
  } catch (error: any) {
    res.status(500).json({ message: "Failed to delete question", error: error.message });
  }
});

// 8. Get all candidate attempts & proctoring status
router.get("/attempts", async (req: AuthRequest, res: Response) => {
  try {
    const attempts = await prisma.assessmentAttempt.findMany({
      include: {
        user: {
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
          },
        },
        assessment: {
          select: { id: true, title: true, durationR1: true, durationR2: true, passingScore: true },
        },
        malpracticeLogs: {
          orderBy: { timestamp: "desc" },
        },
      },
      orderBy: { createdAt: "desc" },
    });

    res.json({ attempts });
  } catch (error: any) {
    res.status(500).json({ message: "Internal server error", error: error.message });
  }
});

// 9. Get malpractice logs
router.get("/malpractice-logs", async (req: AuthRequest, res: Response) => {
  try {
    const logs = await prisma.malpracticeLog.findMany({
      include: {
        user: { select: { id: true, name: true, email: true } },
        attempt: { select: { id: true, assessmentId: true, status: true, tabSwitchCount: true } },
      },
      orderBy: { timestamp: "desc" },
    });

    res.json({ logs });
  } catch (error: any) {
    res.status(500).json({ message: "Internal server error", error: error.message });
  }
});

// 10. Delete a user (student/candidate) completely from the database
router.delete("/users/:id", async (req: AuthRequest, res: Response) => {
  try {
    const id = req.params.id as string;

    // Prevent self-deletion
    if (id === req.user!.id) {
      res.status(400).json({ message: "You cannot delete your own active administrator account." });
      return;
    }

    const userToDelete = await prisma.user.findUnique({ where: { id } });
    if (!userToDelete) {
      res.status(404).json({ message: "User not found" });
      return;
    }

    // Related attempts and malpractice logs cascade automatically via Prisma foreign keys
    await prisma.user.delete({ where: { id } });

    res.json({
      message: `User '${userToDelete.name}' (${userToDelete.email}) was permanently deleted from the database.`,
      deletedUserId: id,
    });
  } catch (error: any) {
    console.error("Delete user error:", error);
    res.status(500).json({ message: "Failed to delete user", error: error.message });
  }
});

// 11. Register/Create a new Administrator account by an existing Admin
router.post("/create-admin", async (req: AuthRequest, res: Response) => {
  try {
    const { name, email, password } = req.body;

    if (!name || !email || !password) {
      res.status(400).json({ message: "Full Name, Email Address, and Password are all required." });
      return;
    }

    if (password.length < 6) {
      res.status(400).json({ message: "Admin password must be at least 6 characters long." });
      return;
    }

    const cleanEmail = email.toLowerCase().trim();
    const existingUser = await prisma.user.findUnique({ where: { email: cleanEmail } });
    if (existingUser) {
      res.status(400).json({ message: "An account with this email address already exists." });
      return;
    }

    const hashedPassword = await bcrypt.hash(password, 10);
    const newAdmin = await prisma.user.create({
      data: {
        name: name.trim(),
        email: cleanEmail,
        password: hashedPassword,
        role: "ADMIN",
        status: "APPROVED",
      },
      select: {
        id: true,
        name: true,
        email: true,
        role: true,
        status: true,
        createdAt: true,
      },
    });

    res.status(201).json({
      message: `New Administrator account created successfully for ${newAdmin.name}!`,
      admin: newAdmin,
    });
  } catch (error: any) {
    console.error("Create admin error:", error);
    res.status(500).json({ message: "Failed to create administrator account", error: error.message });
  }
});

// 12. Get all administrators
router.get("/admins", async (req: AuthRequest, res: Response) => {
  try {
    const admins = await prisma.user.findMany({
      where: { role: "ADMIN" },
      select: {
        id: true,
        name: true,
        email: true,
        role: true,
        status: true,
        createdAt: true,
      },
      orderBy: { createdAt: "desc" },
    });

    res.json({ admins });
  } catch (error: any) {
    console.error("Get admins error:", error);
    res.status(500).json({ message: "Internal server error", error: error.message });
  }
});

export default router;
