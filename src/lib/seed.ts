import bcrypt from "bcrypt";
import prisma from "./prisma";
import {
  allR1AptitudeQuestions,
  softwareDevQuestions,
  dataAnalystQuestions,
  networkEngineerQuestions,
} from "./questionBank";

export async function seedDefaultData() {
  try {
    // 1. Ensure Admin exists
    const adminEmail = "admin@izeon.com";
    const existingAdmin = await prisma.user.findUnique({ where: { email: adminEmail } });

    if (!existingAdmin) {
      const hashedPassword = await bcrypt.hash("admin123", 10);
      await prisma.user.create({
        data: {
          email: adminEmail,
          password: hashedPassword,
          name: "System Admin",
          role: "ADMIN",
          status: "APPROVED",
        },
      });
      console.log("✅ Default Admin created: admin@izeon.com / admin123");
    }

    // Auto-activate any legacy pending students
    await prisma.user.updateMany({
      where: { role: "STUDENT", status: "PENDING_APPROVAL" },
      data: { status: "APPROVED" },
    });

    // 2. Ensure Sample Assessment exists with 70 Marks (20 R1 + 50 R2, Cutoff: 12)
    let activeAssessment = await prisma.assessment.findFirst({ where: { isActive: true } });
    if (!activeAssessment) {
      activeAssessment = await prisma.assessment.create({
        data: {
          title: "IZEON Technical & Cognitive Assessment 2026",
          description:
            "Round 1: 20 Questions (Aptitude & Verbal, 1 Pt each — Cutoff 12). Round 2: 5 Domain-Specific Technical Questions (10 Pts each — Total 50 Pts). Overall total: 70 Marks.",
          durationR1: 30, // 30 mins
          durationR2: 45, // 45 mins
          passingScore: 40,
          cutoffRound1: 12,
          isActive: true,
        },
      });
    } else {
      // Update assessment cutoffRound1 to 12 if not already 12
      await prisma.assessment.update({
        where: { id: activeAssessment.id },
        data: {
          cutoffRound1: 12,
        },
      });
    }

    // 3. Synchronize All 20 Round 1 Aptitude & Reasoning Questions (1 Point Each = 20 Marks)
    for (const q of allR1AptitudeQuestions) {
      const existing = await prisma.question.findFirst({
        where: { assessmentId: activeAssessment.id, title: q.title },
      });
      if (!existing) {
        await (prisma.question as any).create({
          data: {
            assessmentId: activeAssessment.id,
            round: "ROUND_1_APTITUDE_VERBAL_WRITTEN",
            category: q.category as any,
            targetRole: q.targetRole,
            title: q.title,
            content: q.content,
            options: q.options,
            correctAnswer: q.correctAnswer,
            points: 1, // 1 mark each
          } as any,
        });
      } else {
        await prisma.question.update({
          where: { id: existing.id },
          data: { points: 1 },
        });
      }
    }

    // 4. Synchronize Software Developer Questions (5 Questions, 10 Marks Each = 50 Marks)
    for (const q of softwareDevQuestions) {
      const existing = await prisma.question.findFirst({
        where: { assessmentId: activeAssessment.id, title: q.title },
      });
      if (!existing) {
        await (prisma.question as any).create({
          data: {
            assessmentId: activeAssessment.id,
            round: "ROUND_2_CODING",
            category: q.category as any,
            targetRole: "Software Developer",
            title: q.title,
            content: q.content,
            starterCode: q.starterCode,
            testCases: q.testCases,
            points: 10,
          } as any,
        });
      } else {
        await prisma.question.update({
          where: { id: existing.id },
          data: { points: 10, targetRole: "Software Developer" },
        });
      }
    }

    // 5. Synchronize Data Analyst Questions (3 Python + 2 SQL, 10 Marks Each = 50 Marks)
    for (const q of dataAnalystQuestions) {
      const existing = await prisma.question.findFirst({
        where: { assessmentId: activeAssessment.id, title: q.title },
      });
      if (!existing) {
        await (prisma.question as any).create({
          data: {
            assessmentId: activeAssessment.id,
            round: "ROUND_2_CODING",
            category: q.category as any,
            targetRole: "Data Analyst",
            title: q.title,
            content: q.content,
            starterCode: q.starterCode,
            testCases: q.testCases,
            points: 10,
          } as any,
        });
      } else {
        await prisma.question.update({
          where: { id: existing.id },
          data: { points: 10, targetRole: "Data Analyst" },
        });
      }
    }

    // 6. Synchronize Network Engineer Questions (5 Questions, 10 Marks Each = 50 Marks)
    for (const q of networkEngineerQuestions) {
      const existing = await prisma.question.findFirst({
        where: { assessmentId: activeAssessment.id, title: q.title },
      });
      if (!existing) {
        await (prisma.question as any).create({
          data: {
            assessmentId: activeAssessment.id,
            round: "ROUND_2_CODING",
            category: q.category as any,
            targetRole: "Network Engineer",
            title: q.title,
            content: q.content,
            starterCode: (q as any).starterCode || null,
            testCases: (q as any).testCases || null,
            options: (q as any).options || null,
            correctAnswer: (q as any).correctAnswer || null,
            points: 10,
          } as any,
        });
      } else {
        await prisma.question.update({
          where: { id: existing.id },
          data: {
            points: 10,
            targetRole: "Network Engineer",
            category: q.category as any,
            content: q.content,
            starterCode: (q as any).starterCode || null,
            testCases: (q as any).testCases || null,
            options: (q as any).options || null,
            correctAnswer: (q as any).correctAnswer || null,
          },
        });
      }
    }

    // 7. Ensure All Round 2 Questions have targetRole correctly tagged
    await (prisma.question as any).updateMany({
      where: {
        assessmentId: activeAssessment.id,
        round: "ROUND_2_CODING",
        targetRole: null,
      } as any,
      data: {
        targetRole: "Software Developer",
      } as any,
    });

    console.log("✅ Seed complete: 70 Marks total (R1: 20 pts, Cutoff: 12. R2: 50 pts per track [Dev: 5x10, Analyst: 3 Python + 2 SQL, Network: 5x10]).");
  } catch (error) {
    console.error("Seeding error:", error);
  }
}
