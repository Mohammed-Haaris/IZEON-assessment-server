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
    const roleWhere = studentRole
      ? {
          OR: [
            { targetRole: "ALL" },
            { targetRole: studentRole },
            { targetRole: null },
          ],
        }
      : {};

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

    // Check if student already has an ongoing or finished attempt
    const existingAttempt = await prisma.assessmentAttempt.findFirst({
      where: {
        userId: req.user!.id,
        assessmentId: assessment.id,
      },
      orderBy: { createdAt: "desc" },
    });

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

    // Check existing attempt
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

    res.json({
      attempt,
      round1Questions: assessment.questions,
      durationR1: assessment.durationR1,
    });
  } catch (error: any) {
    console.error("Start assessment error:", error);
    res.status(500).json({ message: "Failed to start assessment", error: error.message });
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

    if (attempt.status === "DISQUALIFIED") {
      res.status(403).json({ message: "Attempt disqualified due to malpractice." });
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
          return q.targetRole === "Software Developer" || q.targetRole === "ALL" || !q.targetRole;
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

    if (attempt.status === "DISQUALIFIED") {
      res.status(403).json({ message: "Attempt disqualified due to malpractice." });
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
