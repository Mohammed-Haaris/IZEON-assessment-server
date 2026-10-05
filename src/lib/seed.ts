import bcrypt from "bcrypt";
import prisma from "./prisma";

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

    // Auto-activate any legacy pending students so they have immediate assessment access
    await prisma.user.updateMany({
      where: { role: "STUDENT", status: "PENDING_APPROVAL" },
      data: { status: "APPROVED" },
    });

    // 2. Ensure Sample Assessment exists
    const assessmentCount = await prisma.assessment.count();
    if (assessmentCount === 0) {
      const assessment = await prisma.assessment.create({
        data: {
          title: "IZEON Technical & Cognitive Assessment 2026",
          description:
            "Round 1: Aptitude, Verbal Reasoning, and Written Grammar test. Round 2: Supervised live Coding test with proctoring.",
          durationR1: 25, // 25 mins
          durationR2: 40, // 40 mins
          passingScore: 60,
          isActive: true,
        },
      });

      // Round 1 Common & Role-Specific Questions
      const r1Questions = [
        {
          round: "ROUND_1_APTITUDE_VERBAL_WRITTEN",
          category: "APTITUDE",
          targetRole: "ALL",
          title: "Quantitative Ability: Work & Time",
          content:
            "A can complete a project in 12 days, and B can complete the same project in 18 days. If they work together for 4 days, what fraction of the work remains?",
          options: ["1/3", "4/9", "5/9", "7/18"],
          correctAnswer: "4/9",
          points: 10,
        },
        {
          round: "ROUND_1_APTITUDE_VERBAL_WRITTEN",
          category: "APTITUDE",
          targetRole: "ALL",
          title: "Logical Reasoning: Number Series",
          content: "Find the next number in the sequence: 7, 14, 28, 56, 112, ?",
          options: ["224", "168", "210", "196"],
          correctAnswer: "224",
          points: 10,
        },
        {
          round: "ROUND_1_APTITUDE_VERBAL_WRITTEN",
          category: "VERBAL",
          targetRole: "ALL",
          title: "Verbal Ability: Vocabulary & Analogy",
          content: "Choose the word that is most nearly OPPOSITE in meaning to: 'METICULOUS'",
          options: ["Careless", "Thorough", "Detailed", "Scrupulous"],
          correctAnswer: "Careless",
          points: 10,
        },
        {
          round: "ROUND_1_APTITUDE_VERBAL_WRITTEN",
          category: "VERBAL",
          targetRole: "ALL",
          title: "English Grammar: Sentence Correction",
          content:
            "Select the correct option to fix the underlined segment: 'Neither the manager nor the developers was present at the sync meeting.'",
          options: [
            "Neither the manager nor the developers were present",
            "Neither the manager or the developers was present",
            "Either the manager or the developers was present",
            "No correction needed",
          ],
          correctAnswer: "Neither the manager nor the developers were present",
          points: 10,
        },
        {
          round: "ROUND_1_APTITUDE_VERBAL_WRITTEN",
          category: "WRITTEN_PROMPT",
          targetRole: "ALL",
          title: "Written Assessment: English Grammar & Expression",
          content:
            "Write a brief professional email (100 - 200 words) to your project lead explaining why a software release deadline needs to be pushed back by 3 days due to an edge-case bug discovered during testing. Your submission will be evaluated for grammar, tone, clarity, and spelling.",
          options: null,
          correctAnswer: null,
          points: 20,
        },
      ];

      for (const q of r1Questions) {
        await (prisma.question as any).create({
          data: {
            assessmentId: assessment.id,
            round: q.round as any,
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

      // Round 2 Questions: Software Developer & Data Analyst
      const r2Questions = [
        // Software Developer Track
        {
          round: "ROUND_2_CODING",
          category: "CODING",
          targetRole: "Software Developer",
          title: "Problem 1: Two Sum Target Finder",
          content:
            "Given an array of integers `nums` and an integer `target`, return the indices of the two numbers such that they add up to `target`.\n\nExample:\nInput: nums = [2, 7, 11, 15], target = 9\nOutput: [0, 1]",
          starterCode: {
            javascript: `function twoSum(nums, target) {\n  // Write your code here\n  \n}`,
            python: `def two_sum(nums, target):\n    # Write your code here\n    pass`,
          },
          testCases: [
            { input: "nums = [2, 7, 11, 15], target = 9", output: "[0, 1]", isHidden: false },
            { input: "nums = [3, 2, 4], target = 6", output: "[1, 2]", isHidden: false },
            { input: "nums = [3, 3], target = 6", output: "[0, 1]", isHidden: true },
          ],
          points: 50,
        },
        {
          round: "ROUND_2_CODING",
          category: "CODING",
          targetRole: "Software Developer",
          title: "Problem 2: Valid Palindrome String",
          content:
            "A phrase is a palindrome if, after converting all uppercase letters into lowercase letters and removing all non-alphanumeric characters, it reads the same forward and backward.\n\nExample:\nInput: s = 'A man, a plan, a canal: Panama'\nOutput: true",
          starterCode: {
            javascript: `function isPalindrome(s) {\n  // Write your code here\n  \n}`,
            python: `def is_palindrome(s):\n    # Write your code here\n    pass`,
          },
          testCases: [
            { input: 's = "A man, a plan, a canal: Panama"', output: "true", isHidden: false },
            { input: 's = "race a car"', output: "false", isHidden: false },
            { input: 's = " "', output: "true", isHidden: true },
          ],
          points: 50,
        },
        // Data Analyst Track: Python & SQL
        {
          round: "ROUND_2_CODING",
          category: "SQL",
          targetRole: "Data Analyst",
          title: "SQL Query: High-Spending Department Analytics",
          content:
            "You are given a database table `employees(id, name, department_id, salary, hire_date)`.\n\nWrite a SQL query that retrieves:\n1. `department_id`\n2. `COUNT(*) AS total_employees`\n3. `ROUND(AVG(salary), 2) AS avg_salary`\n\nFilter for only departments where average salary exceeds 50,000, and order the results by `avg_salary` in descending order.",
          starterCode: {
            sql: `-- Write your SQL query here\n`,
            python: `# Write your Python solution here\n`,
          },
          testCases: [
            {
              input: "employees table with 10 records across 3 departments",
              output: "department_id | total_employees | avg_salary\n101 | 4 | 75000.00\n102 | 3 | 54000.00",
              isHidden: false,
            },
          ],
          points: 50,
        },
        {
          round: "ROUND_2_CODING",
          category: "PYTHON",
          targetRole: "Data Analyst",
          title: "Python Data Analysis: Transaction Metrics & Outliers",
          content:
            "Write a Python function `analyze_transactions(transactions, threshold)` that takes:\n- `transactions`: A list of dicts, e.g. `[{'id': 1, 'amount': 150.0, 'category': 'Tech'}, {'id': 2, 'amount': 45.0, 'category': 'Office'}]`\n- `threshold`: A float number\n\nThe function should return a dictionary with:\n- `'total_volume'`: sum of all transaction amounts (float)\n- `'outlier_count'`: number of transactions where amount >= threshold\n- `'category_totals'`: a dict mapping each category to its sum of amounts.",
          starterCode: {
            python: `def analyze_transactions(transactions, threshold):\n    # Write your data analysis code here\n    pass\n`,
          },
          testCases: [
            {
              input: "transactions=[{'amount': 100, 'category': 'A'}, {'amount': 250, 'category': 'B'}], threshold=200",
              output: "{'total_volume': 350.0, 'outlier_count': 1, 'category_totals': {'A': 100.0, 'B': 250.0}}",
              isHidden: false,
            },
          ],
          points: 50,
        },
      ];

      for (const q of r2Questions) {
        await (prisma.question as any).create({
          data: {
            assessmentId: assessment.id,
            round: q.round as any,
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

      console.log("✅ Seeded sample Assessment with Software Developer and Data Analyst (Python & SQL) questions!");
    } else {
      // Check if Data Analyst questions exist in the active assessment, if not add them!
      const activeAssessment = await prisma.assessment.findFirst({ where: { isActive: true } });
      if (activeAssessment) {
        const daCount = await (prisma.question as any).count({
          where: { assessmentId: activeAssessment.id, targetRole: "Data Analyst" } as any,
        });

        if (daCount === 0) {
          // Add Data Analyst questions
          await (prisma.question as any).createMany({
            data: [
              {
                assessmentId: activeAssessment.id,
                round: "ROUND_2_CODING",
                category: "SQL",
                targetRole: "Data Analyst",
                title: "SQL Query: High-Spending Department Analytics",
                content:
                  "You are given a database table `employees(id, name, department_id, salary, hire_date)`.\n\nWrite a SQL query that retrieves:\n1. `department_id`\n2. `COUNT(*) AS total_employees`\n3. `ROUND(AVG(salary), 2) AS avg_salary`\n\nFilter for only departments where average salary exceeds 50,000, and order the results by `avg_salary` in descending order.",
                starterCode: {
                  sql: `-- Write your SQL query here\n`,
                  python: `# Write your Python solution here\n`,
                },
                testCases: [
                  {
                    input: "employees table with 10 records across 3 departments",
                    output: "department_id | total_employees | avg_salary\n101 | 4 | 75000.00\n102 | 3 | 54000.00",
                    isHidden: false,
                  },
                ],
                points: 50,
              },
              {
                assessmentId: activeAssessment.id,
                round: "ROUND_2_CODING",
                category: "PYTHON",
                targetRole: "Data Analyst",
                title: "Python Data Analysis: Transaction Metrics & Outliers",
                content:
                  "Write a Python function `analyze_transactions(transactions, threshold)` that takes:\n- `transactions`: A list of dicts, e.g. `[{'id': 1, 'amount': 150.0, 'category': 'Tech'}, {'id': 2, 'amount': 45.0, 'category': 'Office'}]`\n- `threshold`: A float number\n\nThe function should return a dictionary with:\n- `'total_volume'`: sum of all transaction amounts (float)\n- `'outlier_count'`: number of transactions where amount >= threshold\n- `'category_totals'`: a dict mapping each category to its sum of amounts.",
                starterCode: {
                  python: `def analyze_transactions(transactions, threshold):\n    # Write your data analysis code here\n    pass\n`,
                },
                testCases: [
                  {
                    input: "transactions=[{'amount': 100, 'category': 'A'}, {'amount': 250, 'category': 'B'}], threshold=200",
                    output: "{'total_volume': 350.0, 'outlier_count': 1, 'category_totals': {'A': 100.0, 'B': 250.0}}",
                    isHidden: false,
                  },
                ],
                points: 50,
              },
            ] as any,
          });
          console.log("✅ Seeded Python & SQL questions for Data Analyst!");
        }

        // Tag existing software developer coding questions
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

        // Cleanse any existing questions where starterCode contains answers
        const allQuestions = await prisma.question.findMany({
          where: { round: "ROUND_2_CODING" },
        });
        for (const q of allQuestions) {
          if (q.category === "SQL") {
            await prisma.question.update({
              where: { id: q.id },
              data: {
                starterCode: {
                  sql: "-- Write your SQL query here\n",
                  python: "# Write your Python solution here\n",
                },
              },
            });
          } else if (q.category === "PYTHON" && q.targetRole === "Data Analyst") {
            await prisma.question.update({
              where: { id: q.id },
              data: {
                starterCode: {
                  python: "def analyze_transactions(transactions, threshold):\n    # Write your solution here\n    pass\n",
                },
              },
            });
          }
        }
      }
    }
  } catch (error) {
    console.error("Seeding error:", error);
  }
}
