/**
 * In-memory high performance cache for active assessments and questions.
 * Eliminates 1,000 redundant database roundtrips when students concurrently
 * fetch the assessment structure and questions.
 */

import prisma from "./prisma";

interface CachedAssessmentData {
  assessment: any;
  cachedAt: number;
}

let cachedActiveAssessment: CachedAssessmentData | null = null;
const CACHE_TTL_MS = 60 * 1000; // 60 seconds TTL fallback

/**
 * Invalidate the cache whenever an admin creates, updates, or deletes
 * an assessment or question.
 */
export function invalidateAssessmentCache(): void {
  cachedActiveAssessment = null;
}

/**
 * Get active assessment with questions cached in-memory.
 */
export async function getCachedActiveAssessment(): Promise<any> {
  const now = Date.now();
  if (cachedActiveAssessment && now - cachedActiveAssessment.cachedAt < CACHE_TTL_MS) {
    return cachedActiveAssessment.assessment;
  }

  const assessment = await prisma.assessment.findFirst({
    where: { isActive: true },
    include: {
      questions: {
        select: {
          id: true,
          round: true,
          category: true,
          targetRole: true,
          title: true,
          content: true,
          options: true,
          correctAnswer: true,
          points: true,
          starterCode: true,
          testCases: true,
        },
      },
      _count: {
        select: { questions: true },
      },
    },
  });

  if (assessment) {
    cachedActiveAssessment = {
      assessment,
      cachedAt: now,
    };
  }

  return assessment;
}
