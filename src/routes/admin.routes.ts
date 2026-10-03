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

// 9.1. Admin Give Another Chance to Candidate
router.post("/attempts/:id/give-chance", async (req: AuthRequest, res: Response) => {
  try {
    const attemptId = req.params.id as string;
    const { remarks } = req.body;

    const attempt = await prisma.assessmentAttempt.findUnique({
      where: { id: attemptId },
      include: { user: true },
    });

    if (!attempt) {
      res.status(404).json({ message: "Attempt not found" });
      return;
    }

    await prisma.assessmentAttempt.update({
      where: { id: attemptId },
      data: {
        status: "ROUND_2_IN_PROGRESS",
        tabSwitchCount: 1, // Grace period strike
      },
    });

    await prisma.malpracticeLog.updateMany({
      where: {
        attemptId,
        OR: [{ adminDecision: "PENDING" }, { adminDecision: null }, { adminDecision: "" }],
      },
      data: {
        adminDecision: "GIVEN_CHANCE",
        adminRemarks: remarks || "Admin granted candidate another chance.",
      },
    });

    const io = req.app.get("io");
    if (io) {
      const unlockPayload = {
        attemptId,
        message: "The administrator has granted you another chance. Your test has been unlocked.",
      };
      io.to(`attempt:${attemptId}`).emit("proctor:unlocked", unlockPayload);
      io.emit("proctor:unlocked", unlockPayload);
      io.to("admin_monitor").emit("admin:action_resolved", {
        attemptId,
        decision: "GIVEN_CHANCE",
      });
      io.emit("admin:action_resolved", {
        attemptId,
        decision: "GIVEN_CHANCE",
      });
    }

    res.json({ message: `Successfully gave another chance to ${attempt.user.name}. Exam screen is now unlocked.` });
  } catch (error: any) {
    console.error("Give chance error:", error);
    res.status(500).json({ message: "Failed to give chance", error: error.message });
  }
});

// 9.2. Admin Reject / Disqualify Candidate
router.post("/attempts/:id/reject", async (req: AuthRequest, res: Response) => {
  try {
    const attemptId = req.params.id as string;
    const { remarks } = req.body;

    const attempt = await prisma.assessmentAttempt.findUnique({
      where: { id: attemptId },
      include: { user: true },
    });

    if (!attempt) {
      res.status(404).json({ message: "Attempt not found" });
      return;
    }

    await prisma.assessmentAttempt.update({
      where: { id: attemptId },
      data: {
        status: "DISQUALIFIED",
        completedAt: new Date(),
      },
    });

    await prisma.malpracticeLog.updateMany({
      where: {
        attemptId,
        OR: [{ adminDecision: "PENDING" }, { adminDecision: null }, { adminDecision: "" }],
      },
      data: {
        adminDecision: "REJECTED",
        adminRemarks: remarks || "Disqualified for multiple violations.",
      },
    });

    const io = req.app.get("io");
    if (io) {
      const disqPayload = {
        attemptId,
        message: "Your assessment has been disqualified by the administrator due to malpractice violations.",
      };
      io.to(`attempt:${attemptId}`).emit("proctor:disqualified", disqPayload);
      io.emit("proctor:disqualified", disqPayload);
      io.to("admin_monitor").emit("admin:action_resolved", {
        attemptId,
        decision: "REJECTED",
      });
      io.emit("admin:action_resolved", {
        attemptId,
        decision: "REJECTED",
      });
    }

    res.json({ message: `Successfully disqualified candidate ${attempt.user.name}.` });
  } catch (error: any) {
    console.error("Reject candidate error:", error);
    res.status(500).json({ message: "Failed to reject candidate", error: error.message });
  }
});

// 9.3. Resolve Specific Malpractice Incident Log Directly
router.post("/malpractice-logs/:logId/decision", async (req: AuthRequest, res: Response) => {
  try {
    const logId = req.params.logId as string;
    const { decision, remarks } = req.body; // decision: "GIVEN_CHANCE" | "REJECTED"

    const log = await prisma.malpracticeLog.findUnique({
      where: { id: logId },
      include: { attempt: true, user: true },
    });

    if (!log) {
      res.status(404).json({ message: "Incident log not found" });
      return;
    }

    // 1. Update this specific log
    await prisma.malpracticeLog.update({
      where: { id: logId },
      data: {
        adminDecision: decision,
        adminRemarks: remarks || (decision === "GIVEN_CHANCE" ? "Admin granted candidate another chance." : "Candidate disqualified by admin."),
      },
    });

    // 2. Also update any other pending logs for the same attempt
    if (log.attemptId) {
      await prisma.malpracticeLog.updateMany({
        where: {
          attemptId: log.attemptId,
          OR: [{ adminDecision: "PENDING" }, { adminDecision: null }, { adminDecision: "" }],
        },
        data: {
          adminDecision: decision,
          adminRemarks: remarks || (decision === "GIVEN_CHANCE" ? "Admin granted candidate another chance." : "Candidate disqualified by admin."),
        },
      });

      // 3. Update the corresponding attempt
      if (decision === "GIVEN_CHANCE") {
        await prisma.assessmentAttempt.update({
          where: { id: log.attemptId },
          data: {
            status: "ROUND_2_IN_PROGRESS",
            tabSwitchCount: 1,
          },
        });
      } else if (decision === "REJECTED") {
        await prisma.assessmentAttempt.update({
          where: { id: log.attemptId },
          data: {
            status: "DISQUALIFIED",
            completedAt: new Date(),
          },
        });
      }

      // 4. Broadcast real-time events
      const io = req.app.get("io");
      if (io) {
        if (decision === "GIVEN_CHANCE") {
          const unlockPayload = {
            attemptId: log.attemptId,
            message: "The administrator has granted you another chance. Your test has been unlocked.",
          };
          io.to(`attempt:${log.attemptId}`).emit("proctor:unlocked", unlockPayload);
          io.emit("proctor:unlocked", unlockPayload);
        } else {
          const disqPayload = {
            attemptId: log.attemptId,
            message: "Your assessment has been disqualified by the administrator due to malpractice violations.",
          };
          io.to(`attempt:${log.attemptId}`).emit("proctor:disqualified", disqPayload);
          io.emit("proctor:disqualified", disqPayload);
        }

        io.to("admin_monitor").emit("admin:action_resolved", {
          attemptId: log.attemptId,
          decision,
        });
        io.emit("admin:action_resolved", {
          attemptId: log.attemptId,
          decision,
        });
      }
    }

    res.json({ message: `Successfully resolved incident for ${log.user.name} as ${decision}.` });
  } catch (error: any) {
    console.error("Resolve log error:", error);
    res.status(500).json({ message: "Failed to resolve malpractice log", error: error.message });
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

// 13. Export all students and their assessment details as CSV (Excel compatible)
router.get("/export-students", async (req: AuthRequest, res: Response) => {
  try {
    const students = await prisma.user.findMany({
      where: { role: "STUDENT" },
      include: {
        attempts: {
          include: {
            assessment: { select: { title: true, passingScore: true } },
          },
          orderBy: { createdAt: "desc" },
        },
      },
      orderBy: { createdAt: "desc" },
    });

    const escapeCSV = (val: any) => {
      if (val === null || val === undefined) return '""';
      const s = String(val);
      if (s.includes(",") || s.includes('"') || s.includes("\n") || s.includes("\r")) {
        return `"${s.replace(/"/g, '""')}"`;
      }
      return `"${s}"`;
    };

    const headers = [
      "S.No",
      "Candidate Name",
      "Email Address",
      "Contact Number",
      "Roll Number",
      "College / Institution",
      "Department",
      "Applied Position / Track",
      "Date of Birth",
      "Account Status",
      "Registration Date",
      "Assessment Title",
      "Exam Status",
      "Round 1 Score (pts)",
      "Round 2 Score (pts)",
      "Total Marks (pts)",
      "Passing Criteria",
      "Final Result",
      "Proctoring Tab Switches",
      "Exam Started At",
      "Exam Completed At",
    ];

    const rows = students.map((s, idx) => {
      const att = s.attempts[0];
      const r1 = att?.round1Score ?? null;
      const r2 = att?.round2Score ?? null;
      const total = r1 !== null || r2 !== null ? (r1 ?? 0) + (r2 ?? 0) : null;
      const passingScore = att?.assessment?.passingScore ?? 60;

      let finalResult = "NOT STARTED";
      if (att) {
        if (att.status === "COMPLETED") {
          finalResult = (total ?? 0) >= passingScore ? "QUALIFIED" : "NOT QUALIFIED";
        } else if (att.status === "DISQUALIFIED") {
          finalResult = "DISQUALIFIED";
        } else if (att.status === "MALPRACTICE_LOCKED") {
          finalResult = "SUSPENDED (LOCKED)";
        } else {
          finalResult = "IN PROGRESS";
        }
      }

      return [
        escapeCSV(idx + 1),
        escapeCSV(s.name),
        escapeCSV(s.email),
        escapeCSV(s.mobileNumber || "N/A"),
        escapeCSV(s.rollNumber || "N/A"),
        escapeCSV(s.college || "N/A"),
        escapeCSV(s.department || "N/A"),
        escapeCSV(s.position || "Software Developer"),
        escapeCSV(s.dob || "N/A"),
        escapeCSV(s.status),
        escapeCSV(s.createdAt ? s.createdAt.toLocaleString() : "N/A"),
        escapeCSV(att?.assessment?.title || "N/A"),
        escapeCSV(att ? att.status.replace(/_/g, " ") : "NOT STARTED"),
        escapeCSV(r1 !== null ? r1 : "—"),
        escapeCSV(r2 !== null ? r2 : "—"),
        escapeCSV(total !== null ? total : "—"),
        escapeCSV(`${passingScore} pts`),
        escapeCSV(finalResult),
        escapeCSV(att ? `${att.tabSwitchCount || 0} switches` : "0 switches"),
        escapeCSV(att?.startedAt ? att.startedAt.toLocaleString() : "—"),
        escapeCSV(att?.completedAt ? att.completedAt.toLocaleString() : "—"),
      ].join(",");
    });

    const csvData = "\uFEFF" + [headers.map(escapeCSV).join(","), ...rows].join("\r\n");
    const dateStr = new Date().toISOString().split("T")[0];

    res.setHeader("Content-Type", "text/csv; charset=utf-8");
    res.setHeader("Content-Disposition", `attachment; filename=IZEON_Students_Export_${dateStr}.csv`);
    res.status(200).send(csvData);
  } catch (error: any) {
    console.error("Export students error:", error);
    res.status(500).json({ message: "Failed to export student records", error: error.message });
  }
});

export default router;
