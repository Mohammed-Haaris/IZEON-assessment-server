import bcrypt from "bcrypt";
import prisma from "./prisma";
import { allR1AptitudeQuestions, additionalSoftwareDevQuestions } from "./questionBank";

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

    // 2. Ensure Sample Assessment exists
    let activeAssessment = await prisma.assessment.findFirst({ where: { isActive: true } });
    if (!activeAssessment) {
      activeAssessment = await prisma.assessment.create({
        data: {
          title: "IZEON Technical & Cognitive Assessment 2026",
          description:
            "Round 1: 20+ Aptitude, Logical Reasoning, and Verbal test questions. Round 2: Supervised live Coding / Technical domain assessment.",
          durationR1: 30, // 30 mins
          durationR2: 45, // 45 mins
          passingScore: 60,
          cutoffRound1: 30,
          isActive: true,
        },
      });
    }

    // 3. Synchronize All 21 Round 1 Aptitude & Reasoning Questions
    for (const q of allR1AptitudeQuestions) {
      const exists = await prisma.question.findFirst({
        where: { assessmentId: activeAssessment.id, title: q.title },
      });
      if (!exists) {
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
            points: q.points,
          } as any,
        });
      }
    }

    // 4. Synchronize Additional Difficult Coding Questions for Software Developer
    for (const q of additionalSoftwareDevQuestions) {
      const exists = await prisma.question.findFirst({
        where: { assessmentId: activeAssessment.id, title: q.title },
      });
      if (!exists) {
        await (prisma.question as any).create({
          data: {
            assessmentId: activeAssessment.id,
            round: "ROUND_2_CODING",
            category: q.category as any,
            targetRole: q.targetRole,
            title: q.title,
            content: q.content,
            starterCode: q.starterCode,
            testCases: q.testCases,
            points: q.points,
          } as any,
        });
      }
    }

    // 5. Ensure Existing Coding Questions are Tagged Correctly
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

    console.log("✅ Seed successfully synchronized: 21 Aptitude questions in Round 1 & Advanced Programming problems in Round 2!");
  } catch (error) {
    console.error("Seeding error:", error);
  }
}
