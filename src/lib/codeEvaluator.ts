/**
 * Intelligent Code and Query Evaluator for Assessment Round 2
 * Automatically grades SQL, Python, DSA, and Network Engineering answers.
 * Strictly prevents empty templates, raw text, and boilerplate from earning points.
 */

export interface EvaluationResult {
  score: number;
  maxPoints: number;
  feedback: string;
  isPassed: boolean;
}

export function evaluateCodingAnswer(code: any, question: any): EvaluationResult {
  const maxPoints = Number(question.points) || 50;

  // 1. Check for empty or invalid input
  if (!code || typeof code !== "string" || code.trim().length === 0) {
    return {
      score: 0,
      maxPoints,
      feedback: "No solution submitted.",
      isPassed: false,
    };
  }

  const raw = code.trim();

  // 2. Reject unaltered starter code
  if (question.starterCode && typeof question.starterCode === "object") {
    for (const lang of Object.keys(question.starterCode)) {
      const template = String(question.starterCode[lang] || "").trim();
      if (template && (raw === template || raw.replace(/\s+/g, "") === template.replace(/\s+/g, ""))) {
        return {
          score: 0,
          maxPoints,
          feedback: "Starter template submitted without any implementation.",
          isPassed: false,
        };
      }
    }
  }

  // 3. Strip all comments and trivial boilerplate
  const stripped = raw
    .replace(/--[^\n]*/g, "") // SQL line comments
    .replace(/#[^\n]*/g, "") // Python line comments
    .replace(/\/\/[^\n]*/g, "") // JS line comments
    .replace(/\/\*[\s\S]*?\*\//g, "") // Multi-line comments
    .replace(/"""[\s\S]*?"""/g, "") // Python docstrings
    .replace(/'''[\s\S]*?'''/g, "") // Python single-quote docstrings
    .replace(/\bpass\b/g, "") // Python pass
    .replace(/\breturn\s*(None|null)?\s*;?/g, "") // Empty return
    .replace(/[{};]/g, "") // Braces/semicolons
    .trim();

  // If nothing substantial remains after stripping comments and boilerplate
  if (stripped.length < 8) {
    return {
      score: 0,
      maxPoints,
      feedback: "Submission contains only comments, boilerplate or empty pass statement.",
      isPassed: false,
    };
  }

  // 4. Theoretical MCQ Questions (Network Engineer Theory)
  if (Array.isArray(question.options) && question.correctAnswer) {
    const isCorrect = raw.trim().toLowerCase() === question.correctAnswer.trim().toLowerCase();
    return {
      score: isCorrect ? maxPoints : 0,
      maxPoints,
      feedback: isCorrect ? "Correct answer." : "Incorrect answer.",
      isPassed: isCorrect,
    };
  }

  const titleLower = (question.title || "").toLowerCase();
  const categoryUpper = (question.category || "").toUpperCase();

  // 5. SQL Domain Evaluation
  if (categoryUpper === "SQL" || titleLower.includes("sql") || titleLower.includes("query")) {
    const hasSelectOrWith = /\b(select|with)\b/i.test(raw);
    const hasFrom = /\bfrom\b/i.test(raw);

    // Reject plain text or excel formulas (e.g., "Department id Count" or "=sum(...)")
    if (!hasSelectOrWith || !hasFrom) {
      return {
        score: 0,
        maxPoints,
        feedback: "Invalid SQL syntax: Missing SELECT/WITH and FROM clauses.",
        isPassed: false,
      };
    }

    let earned = Math.floor(maxPoints * 0.3); // Base 30% for valid SELECT ... FROM query structure

    // Department Analytics Question
    if (titleLower.includes("department") || titleLower.includes("spending") || titleLower.includes("salary")) {
      const hasGroupBy = /\bgroup\s+by\b/i.test(raw);
      const hasAvg = /\bavg\b/i.test(raw);
      const hasHavingOrWhere = /\b(having|where)\b/i.test(raw);
      const hasOrderBy = /\border\s+by\b/i.test(raw);

      if (hasGroupBy) earned += Math.round(maxPoints * 0.25);
      if (hasAvg) earned += Math.round(maxPoints * 0.25);
      if (hasHavingOrWhere) earned += Math.round(maxPoints * 0.1);
      if (hasOrderBy) earned += Math.round(maxPoints * 0.1);

      if (hasGroupBy && hasAvg && hasHavingOrWhere && hasOrderBy) {
        earned = maxPoints;
      }

      const finalScore = Math.min(earned, maxPoints);
      return {
        score: finalScore,
        maxPoints,
        feedback: finalScore >= maxPoints * 0.7 ? "SQL Query meets analytical requirements." : "Partial SQL query.",
        isPassed: finalScore >= maxPoints * 0.6,
      };
    }

    // Window Functions & Running Total Question
    if (titleLower.includes("window") || titleLower.includes("rank") || titleLower.includes("running total")) {
      const hasOver = /\bover\s*\(/i.test(raw);
      const hasPartitionOrOrder = /\b(partition\s+by|order\s+by)\b/i.test(raw);
      const hasRankOrSum = /\b(rank|dense_rank|row_number|sum)\b/i.test(raw);

      if (hasOver) earned += Math.floor(maxPoints * 0.35);
      if (hasPartitionOrOrder) earned += Math.floor(maxPoints * 0.2);
      if (hasRankOrSum) earned += Math.floor(maxPoints * 0.15);

      const finalScore = Math.min(earned, maxPoints);
      return {
        score: finalScore,
        maxPoints,
        feedback: finalScore >= maxPoints * 0.7 ? "Window query successfully constructed." : "Partial window query.",
        isPassed: finalScore >= maxPoints * 0.6,
      };
    }

    // Generic SQL query
    return {
      score: maxPoints,
      maxPoints,
      feedback: "Valid SQL query structure.",
      isPassed: true,
    };
  }

  // 6. Python & Software Developer DSA Evaluation
  const hasFunctionDef = /\b(def\s+\w+|function\s+\w+|const\s+\w+\s*=)/.test(raw);
  const hasReturn = /\breturn\b/.test(raw);
  const hasControlFlow = /\b(for\b|while\b|if\b|\.map\(|\.forEach\(|\.filter\(|\.reduce\()/.test(raw);
  const hasDataOps = /([\[\]\{\}]|\.append\(|\.push\(|\.add\(|\.get\(|\+=|\*=)/.test(raw);

  // If it doesn't even have a function, return, or control flow, it is gibberish
  if (!hasFunctionDef && !hasReturn && !hasControlFlow) {
    return {
      score: 0,
      maxPoints,
      feedback: "Code does not contain executable algorithmic or functional logic.",
      isPassed: false,
    };
  }

  // Check specific tasks
  if (titleLower.includes("transaction") || titleLower.includes("outliers")) {
    let score = 0;
    if (hasFunctionDef) score += Math.floor(maxPoints * 0.2);
    if (hasControlFlow) score += Math.floor(maxPoints * 0.3);
    if (/total_volume/i.test(raw) || /category_totals/i.test(raw) || /outlier_count/i.test(raw)) {
      score += Math.floor(maxPoints * 0.3);
    }
    if (hasReturn) score += Math.floor(maxPoints * 0.2);

    const finalScore = Math.min(score, maxPoints);
    return {
      score: finalScore,
      maxPoints,
      feedback: finalScore >= maxPoints * 0.6 ? "Transaction analytics logic implemented." : "Incomplete logic.",
      isPassed: finalScore >= maxPoints * 0.6,
    };
  }

  if (titleLower.includes("retention") || titleLower.includes("cohort")) {
    let score = 0;
    if (hasFunctionDef) score += Math.floor(maxPoints * 0.2);
    if (hasControlFlow) score += Math.floor(maxPoints * 0.3);
    if (/event_month|user_id|cohort/i.test(raw)) score += Math.floor(maxPoints * 0.3);
    if (hasReturn) score += Math.floor(maxPoints * 0.2);

    const finalScore = Math.min(score, maxPoints);
    return {
      score: finalScore,
      maxPoints,
      feedback: finalScore >= maxPoints * 0.6 ? "Cohort retention algorithm implemented." : "Incomplete cohort logic.",
      isPassed: finalScore >= maxPoints * 0.6,
    };
  }

  if (titleLower.includes("subnet") || titleLower.includes("ipv4")) {
    let score = 0;
    if (hasFunctionDef) score += Math.floor(maxPoints * 0.2);
    if (/ipaddress|\/|\.split/i.test(raw)) score += Math.floor(maxPoints * 0.4);
    if (/network_address|broadcast_address|total_usable_hosts/i.test(raw) || hasReturn) {
      score += Math.floor(maxPoints * 0.4);
    }
    const finalScore = Math.min(score, maxPoints);
    return {
      score: finalScore,
      maxPoints,
      feedback: finalScore >= maxPoints * 0.6 ? "Subnet calculator logic present." : "Incomplete subnet logic.",
      isPassed: finalScore >= maxPoints * 0.6,
    };
  }

  if (titleLower.includes("ddos") || titleLower.includes("packet")) {
    let score = 0;
    if (hasFunctionDef) score += Math.floor(maxPoints * 0.2);
    if (hasControlFlow) score += Math.floor(maxPoints * 0.4);
    if (/rate_limit|packet|count|threshold/i.test(raw) || hasReturn) score += Math.floor(maxPoints * 0.4);
    const finalScore = Math.min(score, maxPoints);
    return {
      score: finalScore,
      maxPoints,
      feedback: finalScore >= maxPoints * 0.6 ? "Packet log detection implemented." : "Incomplete anomaly detection.",
      isPassed: finalScore >= maxPoints * 0.6,
    };
  }

  // DSA Algorithm questions (Two Sum, Palindrome, Merge Intervals, Trapping Rain Water, etc.)
  let dsaScore = 0;
  if (hasFunctionDef) dsaScore += Math.floor(maxPoints * 0.25);
  if (hasControlFlow) dsaScore += Math.floor(maxPoints * 0.35);
  if (hasDataOps) dsaScore += Math.floor(maxPoints * 0.2);
  if (hasReturn) dsaScore += Math.floor(maxPoints * 0.2);

  const finalDsa = Math.min(dsaScore, maxPoints);
  return {
    score: finalDsa,
    maxPoints,
    feedback: finalDsa >= maxPoints * 0.6 ? "Algorithm successfully implemented." : "Partial implementation.",
    isPassed: finalDsa >= maxPoints * 0.6,
  };
}
