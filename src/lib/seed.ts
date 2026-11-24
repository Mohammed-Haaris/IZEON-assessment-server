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

    // 1.1 Ensure default Colleges exist & import student colleges
    const defaultColleges = [
      { name: "PSNA College of Engineering and Technology", code: "PSNA" },
      { name: "National Engineering College", code: "NEC" },
      { name: "Anna University, Chennai", code: "AU" },
      { name: "PSG College of Technology, Coimbatore", code: "PSG TECH" },
      { name: "Thiagarajar College of Engineering, Madurai", code: "TCE" },
      { name: "Coimbatore Institute of Technology", code: "CIT" },
      { name: "Kumaraguru College of Technology", code: "KCT" },
      { name: "Sri Sivasubramaniya Nadar College of Engineering", code: "SSN" },
      { name: "Government College of Technology, Coimbatore", code: "GCT" },
      { name: "Kongu Engineering College", code: "KEC" },
      { name: "Mepco Schlenk Engineering College", code: "MEPCO" },
      { name: "Velammal College of Engineering and Technology", code: "VCET" },
    ];

    for (const col of defaultColleges) {
      await prisma.college.upsert({
        where: { name: col.name },
        update: {},
        create: {
          name: col.name,
          code: col.code,
          isActive: true,
        },
      });
    }

    // Automatically import distinct colleges from existing registered candidates
    const existingColleges = await prisma.user.findMany({
      where: { college: { not: null } },
      select: { college: true },
      distinct: ["college"],
    });

    for (const item of existingColleges) {
      if (item.college && item.college.trim()) {
        const trimmed = item.college.trim();
        await prisma.college.upsert({
          where: { name: trimmed },
          update: {},
          create: {
            name: trimmed,
            isActive: true,
          },
        }).catch(() => {});
      }
    }

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
          cutoffRound2: 30,
          isActive: true,
        },
      });
    } else {
      // Update assessment cutoffRound1 and cutoffRound2 if needed
      if ((activeAssessment as any).cutoffRound1 !== 12 || (activeAssessment as any).cutoffRound2 === undefined || (activeAssessment as any).cutoffRound2 === null) {
        await prisma.assessment.update({
          where: { id: activeAssessment.id },
          data: {
            cutoffRound1: 12,
            cutoffRound2: (activeAssessment as any).cutoffRound2 ?? 30,
          },
        });
      }
    }

    // 2.1 Deduplicate any questions that may have duplicate titles in activeAssessment
    const allExistingQuestions = await prisma.question.findMany({
      where: { assessmentId: activeAssessment.id },
      orderBy: { createdAt: "asc" },
    });

    const seenQuestions = new Map<string, string>();
    const duplicateIdsToDelete: string[] = [];

    for (const q of allExistingQuestions) {
      const key = `${q.round}_${(q.targetRole || "ALL").trim().toLowerCase()}_${q.title.trim().toLowerCase()}`;
      if (seenQuestions.has(key)) {
        duplicateIdsToDelete.push(q.id);
      } else {
        seenQuestions.set(key, q.id);
      }
    }

    if (duplicateIdsToDelete.length > 0) {
      await prisma.question.deleteMany({
        where: { id: { in: duplicateIdsToDelete } },
      });
      console.log(`🧹 Deleted ${duplicateIdsToDelete.length} duplicate questions from active assessment.`);
    }

    // 3. Synchronize All 20 Round 1 Aptitude & Reasoning Questions (1 Point Each = 20 Marks, Shuffled Options)
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
          data: {
            points: 1,
            options: q.options,
            correctAnswer: q.correctAnswer,
            content: q.content,
            category: q.category as any,
            targetRole: q.targetRole,
          },
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
          data: {
            points: 10,
            targetRole: "Software Developer",
            category: q.category as any,
            content: q.content,
            starterCode: q.starterCode,
            testCases: q.testCases,
          },
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
      } else if (existing.points !== 10 || (existing as any).targetRole !== "Data Analyst") {
        await prisma.question.update({
          where: { id: existing.id },
          data: {
            points: 10,
            targetRole: "Data Analyst",
            category: q.category as any,
            content: q.content,
            starterCode: q.starterCode,
            testCases: q.testCases,
          },
        });
      }
    }

    // 6. Delete legacy MCQ questions for Network Engineer so only practical problems remain
    await (prisma.question as any).deleteMany({
      where: {
        assessmentId: activeAssessment.id,
        targetRole: "Network Engineer",
        options: { not: null },
      } as any,
    });

    // Synchronize Network Engineer Questions (5 Questions, 10 Marks Each = 50 Marks)
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
      } else if (existing.points !== 10 || (existing as any).targetRole !== "Network Engineer") {
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
