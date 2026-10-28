import { Router, Response } from "express";
import prisma from "../lib/prisma";
import {
  authenticateToken,
  requireApprovedStudent,
  AuthRequest,
} from "../middleware/auth.middleware";
import { getCachedActiveAssessment } from "../lib/assessmentCache";

const router = Router();

router.use(authenticateToken);
router.use(requireApprovedStudent);

// Helper to filter questions by candidate role in memory
function filterQuestionsForRole(questions: any[], studentRole?: string | null) {
  if (!studentRole) return questions;

  return questions.filter((q) => {
    if (studentRole === "Software Developer") {
      const matchRole =
        q.targetRole === "ALL" ||
        q.targetRole === "Software Developer" ||
        !q.targetRole;
      return matchRole && q.category !== "SQL";
    }

    if (studentRole === "Data Analyst") {
      return (
        q.targetRole === "ALL" ||
        q.targetRole === "Data Analyst" ||
        !q.targetRole
      );
    }

    return (
      q.targetRole === "ALL" ||
      q.targetRole === studentRole ||
      !q.targetRole
    );
  });
}

// 1. Get active assessment for the student (High performance cached read)
router.get("/active", async (req: AuthRequest, res: Response) => {
  try {
    const studentRole = req.user?.position;
    const activeAssessment = await getCachedActiveAssessment();

    if (!activeAssessment) {
      res.status(404).json({ message: "No active assessment found." });
      return;
    }

    // Filter questions in memory for student role (0ms CPU operation)
    const filteredQuestions = filterQuestionsForRole(activeAssessment.questions, studentRole);

    const assessment = {
      ...activeAssessment,
      questions: filteredQuestions,
      _count: {
        questions: filteredQuestions.length,
      },
    };

    // Single indexed query to fetch student's latest attempt
    const existingAttempt = await prisma.assessmentAttempt.findFirst({
      where: {
        userId: req.user!.id,
        assessmentId: activeAssessment.id,
      },
      orderBy: { createdAt: "desc" },
    });

    res.json({ assessment, existingAttempt });
  } catch (error: any) {
    console.error("Fetch active assessment error:", error);
    res.status(500).json({ message: "Internal server error", error: error.message });
  }
});

// 2. Start Assessment (High performance cached read + single attempt check)
router.post("/start", async (req: AuthRequest, res: Response) => {
  try {
    const { assessmentId } = req.body;
    const studentRole = req.user?.position;

    // Use cached active assessment if no specific id or matches active id
    let assessment = await getCachedActiveAssessment();
    if (!assessment || (assessmentId && assessment.id !== assessmentId)) {
      assessment = assessmentId
        ? await prisma.assessment.findUnique({
            where: { id: assessmentId },
            include: { questions: true },
          })
        : await prisma.assessment.findFirst({
            where: { isActive: true },
            include: { questions: true },
          });
    }

    if (!assessment || !assessment.isActive) {
      res.status(404).json({ message: "Active assessment not found." });
      return;
    }

    // In-memory filter for Round 1 questions
    const round1Questions = filterQuestionsForRole(
      (assessment.questions || []).filter(
        (q: any) => q.round === "ROUND_1_APTITUDE_VERBAL_WRITTEN"
      ),
      studentRole
    ).map((q: any) => ({
      id: q.id,
      round: q.round,
      category: q.category,
      targetRole: q.targetRole,
      title: q.title,
      content: q.content,
      options: q.options,
      points: q.points,
    }));

    // Single indexed query for student's attempt
    let attempt = await prisma.assessmentAttempt.findFirst({
      where: {
        userId: req.user!.id,
        assessmentId: assessment.id,
      },
      orderBy: { createdAt: "desc" },
    });

    // 1. Strictly block retakes if student already COMPLETED or was DISQUALIFIED
    if (attempt && (attempt.status === "COMPLETED" || attempt.status === "DISQUALIFIED")) {
      res.status(403).json({
        message: "You have already completed this assessment. Resuming or retaking is strictly not permitted.",
        attempt,
        alreadyFinished: true,
      });
      return;
    }

    // 2. Create attempt if not started yet
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
      round1Questions,
      durationR1: assessment.durationR1,
    });
  } catch (error: any) {
    console.error("Start assessment error:", error);
    res.status(500).json({ message: "Failed to start assessment", error: error.message });
  }
});

// 2.5 Report Malpractice / Tab Switch (Direct REST fallback with real-time push)
const lastTabSwitchRest = new Map<string, number>();

// Periodic memory pruning to prevent leak
setInterval(() => {
  const now = Date.now();
  for (const [key, timestamp] of lastTabSwitchRest.entries()) {
    if (now - timestamp > 5 * 60 * 1000) {
      lastTabSwitchRest.delete(key);
    }
  }
}, 5 * 60 * 1000);

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
        // Send alert ONLY to candidate room
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
        // Send alert ONLY to admin monitor room (prevents broadcasting to 1000 other students)
        io.to("admin_monitor").emit("admin:malpractice_alert", alertPayload);
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

    // Determine qualification for Round 2 based on Admin-configured Cutoff
    const cutoffRound1 = (attempt.assessment as any).cutoffRound1 ?? 12;
    const isQualified = round1Score >= cutoffRound1;

    // Update attempt: If not qualified, mark COMPLETED and lock out of Round 2
    const updatedAttempt = await prisma.assessmentAttempt.update({
      where: { id: attemptId },
      data: {
        round1Score,
        writtenEssay: writtenEssay || "",
        status: isQualified ? "ROUND_2_IN_PROGRESS" : "COMPLETED",
        currentRound: isQualified ? "ROUND_2_CODING" : "ROUND_1_APTITUDE_VERBAL_WRITTEN",
        completedAt: isQualified ? null : new Date(),
        answers: {
          ...(typeof attempt.answers === "object" && attempt.answers !== null ? attempt.answers : {}),
          round1Answers: mcqAnswers,
        },
      },
    });

    // Fetch Round 2 coding questions only if student qualified
    const studentRole = req.user?.position;
    const codingQuestions = isQualified
      ? ((attempt.assessment.questions as any[]) || [])
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
          })
      : [];

    res.json({
      success: true,
      isQualified,
      cutoffRound1,
      round1Score,
      message: isQualified
        ? "Congratulations! You have qualified for Round 2 (Coding & Technical Assessment)."
        : `Assessment Completed. Your Round 1 score is ${round1Score} pts (Cutoff: ${cutoffRound1} pts). You have not qualified for Round 2.`,
      attempt: updatedAttempt,
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
