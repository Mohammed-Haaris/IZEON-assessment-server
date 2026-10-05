import { Router, Response } from "express";
import prisma from "../lib/prisma";
import {
  authenticateToken,
  requireApprovedStudent,
  AuthRequest,
} from "../middleware/auth.middleware";

const router = Router();

router.use(authenticateToken);
router.use(requireApprovedStudent);

// 1. Get active assessment for the student
router.get("/active", async (req: AuthRequest, res: Response) => {
  try {
    const studentRole = req.user?.position;
    let roleWhere: any = {};
    if (studentRole === "Software Developer") {
      roleWhere = {
        AND: [
          {
            OR: [
              { targetRole: "ALL" },
              { targetRole: "Software Developer" },
              { targetRole: null },
            ],
          },
          { category: { not: "SQL" } },
        ],
      };
    } else if (studentRole === "Data Analyst") {
      roleWhere = {
        OR: [
          { targetRole: "ALL" },
          { targetRole: "Data Analyst" },
          { targetRole: null },
        ],
      };
    } else if (studentRole) {
      roleWhere = {
        OR: [
          { targetRole: "ALL" },
          { targetRole: studentRole },
          { targetRole: null },
        ],
      };
    }

    const assessment: any = await prisma.assessment.findFirst({
      where: { isActive: true },
      include: {
        questions: {
          where: roleWhere as any,
          select: {
            id: true,
            round: true,
            category: true,
            targetRole: true,
            title: true,
            content: true,
            options: true,
            points: true,
            starterCode: true,
            testCases: true,
          } as any,
        },
        _count: {
          select: { questions: true },
        },
      },
    });

    if (!assessment) {
      res.status(404).json({ message: "No active assessment found." });
      return;
    }

    // Check if student already has a finished or ongoing attempt
    const finishedAttempt = await prisma.assessmentAttempt.findFirst({
      where: {
        userId: req.user!.id,
        assessmentId: assessment.id,
        status: { in: ["COMPLETED", "DISQUALIFIED"] },
      },
      orderBy: { createdAt: "desc" },
    });

    const ongoingAttempt = await prisma.assessmentAttempt.findFirst({
      where: {
        userId: req.user!.id,
        assessmentId: assessment.id,
        status: { notIn: ["COMPLETED", "DISQUALIFIED"] },
      },
      orderBy: { createdAt: "desc" },
    });

    const existingAttempt = finishedAttempt || ongoingAttempt;

    res.json({ assessment, existingAttempt });
  } catch (error: any) {
    res.status(500).json({ message: "Internal server error", error: error.message });
  }
});

// 2. Start Assessment
router.post("/start", async (req: AuthRequest, res: Response) => {
  try {
    const { assessmentId } = req.body;
    const studentRole = req.user?.position;

    const round1Where: any = {
      round: "ROUND_1_APTITUDE_VERBAL_WRITTEN",
    };
    if (studentRole) {
      round1Where.OR = [
        { targetRole: "ALL" },
        { targetRole: studentRole },
        { targetRole: null },
      ];
    }

    const assessment: any = assessmentId
      ? await prisma.assessment.findUnique({
          where: { id: assessmentId },
          include: {
            questions: {
              where: round1Where as any,
              select: {
                id: true,
                round: true,
                category: true,
                targetRole: true,
                title: true,
                content: true,
                options: true,
                points: true,
              } as any,
            },
          },
        })
      : await prisma.assessment.findFirst({
          where: { isActive: true },
          include: {
            questions: {
              where: round1Where as any,
              select: {
                id: true,
                round: true,
                category: true,
                targetRole: true,
                title: true,
                content: true,
                options: true,
                points: true,
              } as any,
            },
          },
        });

    if (!assessment || !assessment.isActive) {
      res.status(404).json({ message: "Active assessment not found." });
      return;
    }

    // 1. Strictly block retakes if student already COMPLETED or was DISQUALIFIED
    const alreadyFinished = await prisma.assessmentAttempt.findFirst({
      where: {
        userId: req.user!.id,
        assessmentId: assessment.id,
        status: { in: ["COMPLETED", "DISQUALIFIED"] },
      },
      orderBy: { createdAt: "desc" },
    });

    if (alreadyFinished) {
      res.status(403).json({
        message: "You have already completed this assessment. Resuming or retaking is strictly not permitted.",
        attempt: alreadyFinished,
        alreadyFinished: true,
      });
      return;
    }

    // 2. Check existing in-progress attempt
    let attempt = await prisma.assessmentAttempt.findFirst({
      where: {
        userId: req.user!.id,
        assessmentId: assessment.id,
        status: { notIn: ["COMPLETED", "DISQUALIFIED"] },
      },
    });

    if (!attempt) {
      attempt = await prisma.assessmentAttempt.create({
        data: {
          userId: req.user!.id,
          assessmentId: assessment.id,
          status: "ROUND_1_IN_PROGRESS",
          currentRound: "ROUND_1_APTITUDE_VERBAL_WRITTEN",
          startedAt: new Date(),
        },
      });
    }

    const isLocked = attempt.status === "MALPRACTICE_LOCKED" || attempt.tabSwitchCount >= 2;

    res.json({
      attempt,
      isLocked,
      lockMessage: isLocked
        ? "Assessment locked due to multiple malpractice violations. Administrator has been notified to review your session."
        : undefined,
      round1Questions: assessment.questions,
      durationR1: assessment.durationR1,
    });
  } catch (error: any) {
    console.error("Start assessment error:", error);
    res.status(500).json({ message: "Failed to start assessment", error: error.message });
  }
});

// 2.5 Report Malpractice / Tab Switch (Direct REST fallback with real-time push)
const lastTabSwitchRest = new Map<string, number>();

router.post("/report-malpractice", async (req: AuthRequest, res: Response) => {
  try {
    const { attemptId, violationType = "TAB_SWITCH" } = req.body;
    if (!attemptId) {
      res.status(400).json({ message: "attemptId is required" });
      return;
    }

    const now = Date.now();
    const lastTime = lastTabSwitchRest.get(attemptId) || 0;
    if (now - lastTime < 1000) {
      res.json({ message: "Duplicate violation ignored within 1s window" });
      return;
    }
    lastTabSwitchRest.set(attemptId, now);

    const attempt = await prisma.assessmentAttempt.findUnique({
      where: { id: attemptId },
      include: { user: true, assessment: true },
    });

    if (!attempt) {
      res.status(404).json({ message: "Attempt not found" });
      return;
    }

    if (attempt.status === "COMPLETED" || attempt.status === "DISQUALIFIED") {
      res.json({ message: "Attempt already finalized", attempt });
      return;
    }

    const newCount = attempt.tabSwitchCount + 1;
    const isLocked = newCount >= 2;

    const updatedAttempt = await prisma.assessmentAttempt.update({
      where: { id: attemptId },
      data: {
        tabSwitchCount: newCount,
        status: isLocked ? "MALPRACTICE_LOCKED" : attempt.status,
      },
    });

    const log = await prisma.malpracticeLog.create({
      data: {
        attemptId: attempt.id,
        userId: attempt.userId,
        violationType,
        violationCount: newCount,
        adminDecision: isLocked ? "PENDING" : null,
      },
    });

    const io = req.app.get("io");
    if (io) {
      if (isLocked) {
        io.to(`attempt:${attemptId}`).emit("proctor:locked", {
          count: newCount,
          message:
            "Assessment locked due to multiple malpractice violations. Administrator has been notified to review your session.",
        });
        const alertPayload = {
          attemptId: attempt.id,
          logId: log.id,
          studentId: attempt.user.id,
          studentName: attempt.user.name,
          studentEmail: attempt.user.email,
          assessmentTitle: attempt.assessment.title,
          violationType,
          violationCount: newCount,
          timestamp: new Date(),
        };
        io.to("admin_monitor").emit("admin:malpractice_alert", alertPayload);
        io.emit("admin:malpractice_alert", alertPayload);
      } else {
        io.to(`attempt:${attemptId}`).emit("proctor:warning", {
          count: 1,
          message:
            "Warning 1 of 2: Tab switch detected! One more tab switch will flag you for malpractice and lock your test.",
        });
      }
    }

    res.json({
      success: true,
      tabSwitchCount: newCount,
      isLocked,
      status: updatedAttempt.status,
    });
  } catch (error: any) {
    console.error("Report malpractice error:", error);
    res.status(500).json({ message: "Internal server error", error: error.message });
  }
});

// 3. Submit Round 1 (Aptitude, Verbal, Written Assessment)
router.post("/submit-round1", async (req: AuthRequest, res: Response) => {
  try {
    const { attemptId, mcqAnswers, writtenEssay } = req.body;

    const attempt = await prisma.assessmentAttempt.findUnique({
      where: { id: attemptId },
      include: {
        assessment: {
          include: {
            questions: true,
          },
        },
      },
    });

    if (!attempt || attempt.userId !== req.user!.id) {
      res.status(404).json({ message: "Attempt not found" });
      return;
    }

    if (attempt.status === "COMPLETED" || attempt.status === "DISQUALIFIED") {
      res.status(403).json({ message: "This assessment has already been completed. Further submissions are prohibited." });
      return;
    }

    if (attempt.status === "MALPRACTICE_LOCKED" || attempt.tabSwitchCount >= 2) {
      res.status(403).json({
        message: "Your assessment is currently locked due to malpractice violations. Submissions are prohibited until unlocked by an administrator.",
        isLocked: true,
      });
      return;
    }

    // Grade Round 1 MCQs
    const round1Questions = attempt.assessment.questions.filter(
      (q) => q.round === "ROUND_1_APTITUDE_VERBAL_WRITTEN" && q.category !== "WRITTEN_PROMPT"
    );

    let round1Score = 0;
    round1Questions.forEach((q) => {
      const studentAns = mcqAnswers?.[q.id];
      if (studentAns && q.correctAnswer && studentAns.trim() === q.correctAnswer.trim()) {
        round1Score += q.points;
      }
    });

    // Update attempt
    const updatedAttempt = await prisma.assessmentAttempt.update({
      where: { id: attemptId },
      data: {
        round1Score,
        writtenEssay: writtenEssay || "",
        status: "ROUND_2_IN_PROGRESS",
        currentRound: "ROUND_2_CODING",
        answers: {
          ...(typeof attempt.answers === "object" && attempt.answers !== null ? attempt.answers : {}),
          round1Answers: mcqAnswers,
        },
      },
    });

    // Fetch Round 2 coding questions (hide hidden test cases)
    const studentRole = req.user?.position;
    const codingQuestions = ((attempt.assessment.questions as any[]) || [])
      .filter((q: any) => {
        if (q.round !== "ROUND_2_CODING") return false;
        if (!studentRole) return true;
        if (studentRole === "Data Analyst") {
          return q.targetRole === "Data Analyst" || q.targetRole === "ALL" || !q.targetRole;
        }
        if (studentRole === "Software Developer") {
          return (
            (q.targetRole === "Software Developer" || q.targetRole === "ALL" || !q.targetRole) &&
            q.category !== "SQL"
          );
        }
        return true;
      })
      .map((q: any) => {
        let publicTestCases = [];
        if (Array.isArray(q.testCases)) {
          publicTestCases = (q.testCases as any[]).filter((tc) => !tc.isHidden);
        }
        return {
          id: q.id,
          title: q.title,
          content: q.content,
          category: q.category,
          targetRole: q.targetRole,
          points: q.points,
          starterCode: q.starterCode,
          testCases: publicTestCases,
        };
      });

    res.json({
      message: "Round 1 completed successfully! Proceeding to Round 2.",
      attempt: updatedAttempt,
      round1Score,
      codingQuestions,
      durationR2: attempt.assessment.durationR2,
    });
  } catch (error: any) {
    console.error("Submit round 1 error:", error);
    res.status(500).json({ message: "Failed to submit round 1", error: error.message });
  }
});

// 4. Submit Round 2 (Coding)
router.post("/submit-round2", async (req: AuthRequest, res: Response) => {
  try {
    const { attemptId, codeAnswers } = req.body;

    const attempt = await prisma.assessmentAttempt.findUnique({
      where: { id: attemptId },
      include: {
        assessment: {
          include: { questions: true },
        },
      },
    });

    if (!attempt || attempt.userId !== req.user!.id) {
      res.status(404).json({ message: "Attempt not found" });
      return;
    }

    if (attempt.status === "COMPLETED" || attempt.status === "DISQUALIFIED") {
      res.status(403).json({ message: "This assessment has already been finalized and submitted." });
      return;
    }

    if (attempt.status === "MALPRACTICE_LOCKED" || attempt.tabSwitchCount >= 2) {
      res.status(403).json({
        message: "Your assessment is currently locked due to malpractice violations. Submissions are prohibited until unlocked by an administrator.",
        isLocked: true,
      });
      return;
    }

    // Calculate score for Round 2 code/query submissions
    let round2Score = 0;
    const r2Questions = attempt.assessment.questions.filter((q) => q.round === "ROUND_2_CODING");
    r2Questions.forEach((q) => {
      const code = codeAnswers?.[q.id];
      if (code && typeof code === "string" && code.trim().length > 25) {
        round2Score += q.points || 50;
      }
    });

    const updatedAttempt = await prisma.assessmentAttempt.update({
      where: { id: attemptId },
      data: {
        status: "COMPLETED",
        round2Score,
        completedAt: new Date(),
        answers: {
          ...(typeof attempt.answers === "object" && attempt.answers !== null ? attempt.answers : {}),
          codingAnswers: codeAnswers,
        },
      },
    });

    res.json({
      message: "Assessment completed and submitted successfully!",
      attempt: updatedAttempt,
    });
  } catch (error: any) {
    console.error("Submit round 2 error:", error);
    res.status(500).json({ message: "Failed to submit round 2", error: error.message });
  }
});

// 5. Get current status of an attempt
router.get("/attempt/:id", async (req: AuthRequest, res: Response) => {
  try {
    const id = req.params.id as string;
    const attempt = await prisma.assessmentAttempt.findUnique({
      where: { id },
      include: {
        assessment: {
          select: { id: true, title: true, durationR1: true, durationR2: true },
        },
      },
    });

    if (!attempt) {
      res.status(404).json({ message: "Attempt not found" });
      return;
    }

    res.json({ attempt });
  } catch (error: any) {
    res.status(500).json({ message: "Internal server error", error: error.message });
  }
});

export default router;
