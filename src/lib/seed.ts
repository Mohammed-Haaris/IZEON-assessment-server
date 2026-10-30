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
            "Round 1: Aptitude, Verbal Reasoning, and Written Grammar test. Round 2: Supervised live Coding / Domain Technical test.",
          durationR1: 25,
          durationR2: 40,
          passingScore: 60,
          cutoffRound1: 12,
          isActive: true,
        },
      });
    }

    // 3. Ensure Difficult Round 1 Aptitude Questions Exist
    const r1DifficultAptitude = [
      {
        assessmentId: activeAssessment.id,
        round: "ROUND_1_APTITUDE_VERBAL_WRITTEN",
        category: "APTITUDE",
        targetRole: "ALL",
        title: "Advanced Quantitative: Permutations & Combinations",
        content:
          "A committee of 5 is to be formed from 6 men and 4 women. In how many ways can this be done if the committee must contain at least 2 women?",
        options: ["186", "246", "196", "210"],
        correctAnswer: "186",
        points: 15,
      },
      {
        assessmentId: activeAssessment.id,
        round: "ROUND_1_APTITUDE_VERBAL_WRITTEN",
        category: "APTITUDE",
        targetRole: "ALL",
        title: "Advanced Quantitative: Relative Speed & Trains",
        content:
          "Two trains 140 m and 160 m long run at speeds of 60 km/hr and 40 km/hr respectively in opposite directions on parallel tracks. What is the exact time (in seconds) they take to cross each other from the moment they meet?",
        options: ["10.8 seconds", "12.4 seconds", "9.6 seconds", "15.0 seconds"],
        correctAnswer: "10.8 seconds",
        points: 15,
      },
      {
        assessmentId: activeAssessment.id,
        round: "ROUND_1_APTITUDE_VERBAL_WRITTEN",
        category: "APTITUDE",
        targetRole: "ALL",
        title: "Advanced Quantitative: Partnership & Simple Interest",
        content:
          "A man invests $12,000 partly at 8% per annum and the remainder at 10% per annum simple interest. If the total annual interest received is $1,080, how much money was invested at 8%?",
        options: ["$6,000", "$5,000", "$7,000", "$4,500"],
        correctAnswer: "$6,000",
        points: 15,
      },
    ];

    for (const q of r1DifficultAptitude) {
      const exists = await prisma.question.findFirst({
        where: { assessmentId: activeAssessment.id, title: q.title },
      });
      if (!exists) {
        await (prisma.question as any).create({ data: q as any });
      }
    }

    // 4. Ensure Difficult Round 2 Questions for Software Developer
    const devDifficultR2 = [
      {
        assessmentId: activeAssessment.id,
        round: "ROUND_2_CODING",
        category: "CODING",
        targetRole: "Software Developer",
        title: "Problem 3: Longest Substring Without Repeating Characters",
        content:
          "Given a string s, find the length of the longest substring without repeating characters.\n\nExample:\nInput: s = 'abcabcbb'\nOutput: 3 (The answer is 'abc')\n\nConstraints: 0 <= s.length <= 5 * 10^4",
        starterCode: {
          javascript: "function lengthOfLongestSubstring(s) {\n  // Sliding window approach\n  \n}",
          python: "def length_of_longest_substring(s):\n    # Sliding window approach\n    pass\n",
        },
        testCases: [
          { input: "s = 'abcabcbb'", output: "3", isHidden: false },
          { input: "s = 'bbbbb'", output: "1", isHidden: false },
          { input: "s = 'pwwkew'", output: "3", isHidden: true },
        ],
        points: 50,
      },
      {
        assessmentId: activeAssessment.id,
        round: "ROUND_2_CODING",
        category: "CODING",
        targetRole: "Software Developer",
        title: "Problem 4: Merge Overlapping Intervals",
        content:
          "Given an array of intervals where intervals[i] = [start_i, end_i], merge all overlapping intervals and return an array of non-overlapping intervals.\n\nExample:\nInput: intervals = [[1,3],[2,6],[8,10],[15,18]]\nOutput: [[1,6],[8,10],[15,18]]",
        starterCode: {
          javascript: "function merge(intervals) {\n  // Sort and merge overlapping intervals\n  \n}",
          python: "def merge(intervals):\n    # Sort and merge overlapping intervals\n    pass\n",
        },
        testCases: [
          { input: "intervals = [[1,3],[2,6],[8,10],[15,18]]", output: "[[1,6],[8,10],[15,18]]", isHidden: false },
          { input: "intervals = [[1,4],[4,5]]", output: "[[1,5]]", isHidden: false },
          { input: "intervals = [[1,4],[0,4]]", output: "[[0,4]]", isHidden: true },
        ],
        points: 50,
      },
    ];

    for (const q of devDifficultR2) {
      const exists = await prisma.question.findFirst({
        where: { assessmentId: activeAssessment.id, title: q.title },
      });
      if (!exists) {
        await (prisma.question as any).create({ data: q as any });
      }
    }

    // 5. Ensure Difficult Round 2 Questions for Data Analyst (Advanced SQL & Python)
    const daDifficultR2 = [
      {
        assessmentId: activeAssessment.id,
        round: "ROUND_2_CODING",
        category: "SQL",
        targetRole: "Data Analyst",
        title: "Advanced SQL: Running Total & Rank Window Functions",
        content:
          "Given a database table `sales(id, salesperson, region, amount, sale_date)`.\n\nWrite a SQL query that retrieves:\n1. `salesperson`\n2. `region`\n3. `total_sales`: SUM(amount) per salesperson\n4. `rank_in_region`: DENSE_RANK() within region ordered by total_sales DESC\n\nFilter only for salespersons where total_sales > 50000, and order by region ASC, rank_in_region ASC.",
        starterCode: {
          sql: "-- Write your advanced SQL window query here\n",
          python: "# Write your Python solution here\n",
        },
        testCases: [
          {
            input: "sales table with 20 records across 3 regions",
            output: "Alice | North | 95000 | 1\nBob | North | 72000 | 2\nCarol | South | 88000 | 1",
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
        title: "Advanced Python Analytics: Customer Cohort Retention",
        content:
          "Write a Python function `compute_retention(events, cohort_month)` that takes:\n- `events`: List of dicts `[{'user_id': str, 'event_month': 'YYYY-MM'}, ...]`\n- `cohort_month`: String 'YYYY-MM' representing the signup cohort month\n\nReturn a dictionary mapping month offsets (0, 1, 2) to retention rate (float 0.0 - 1.0) indicating the fraction of initial cohort users active in that month.",
        starterCode: {
          python: "def compute_retention(events, cohort_month):\n    # Calculate cohort retention rates\n    pass\n",
        },
        testCases: [
          {
            input: "events=[{'user_id':'u1','event_month':'2026-01'},{'user_id':'u1','event_month':'2026-02'},{'user_id':'u2','event_month':'2026-01'}], cohort_month='2026-01'",
            output: "{0: 1.0, 1: 0.5}",
            isHidden: false,
          },
        ],
        points: 50,
      },
    ];

    for (const q of daDifficultR2) {
      const exists = await prisma.question.findFirst({
        where: { assessmentId: activeAssessment.id, title: q.title },
      });
      if (!exists) {
        await (prisma.question as any).create({ data: q as any });
      }
    }

    // 6. Ensure Difficult Round 2 Questions for Network Engineer (Theoretical MCQs + Automation)
    const neDifficultR2 = [
      {
        assessmentId: activeAssessment.id,
        round: "ROUND_2_CODING",
        category: "CODING",
        targetRole: "Network Engineer",
        title: "Advanced Network Theory: BGP Best Path Selection Algorithm",
        content:
          "In BGP path selection when a router receives multiple paths to the same destination network prefix, which BGP attribute is evaluated FIRST to determine the best path?",
        options: [
          "Weight (Cisco-specific) or LOCAL_PREF (Standard)",
          "AS_PATH length",
          "Origin Code (IGP vs EGP vs Incomplete)",
          "Multi-Exit Discriminator (MED)",
        ],
        correctAnswer: "Weight (Cisco-specific) or LOCAL_PREF (Standard)",
        points: 25,
      },
      {
        assessmentId: activeAssessment.id,
        round: "ROUND_2_CODING",
        category: "CODING",
        targetRole: "Network Engineer",
        title: "Advanced Network Theory: Spanning Tree Protocol (STP) Root Election",
        content:
          "In IEEE 802.1D Spanning Tree Protocol, if two switches have identical Bridge Priority of 32768, how is the Root Bridge elected?",
        options: [
          "Switch with the lowest MAC address",
          "Switch with the highest IP address",
          "Switch with the most active ports",
          "Switch with the highest uptime",
        ],
        correctAnswer: "Switch with the lowest MAC address",
        points: 25,
      },
      {
        assessmentId: activeAssessment.id,
        round: "ROUND_2_CODING",
        category: "CODING",
        targetRole: "Network Engineer",
        title: "Advanced Network Theory: OSPF LSA Types & Area Routing",
        content:
          "Which OSPF LSA type is generated by an Autonomous System Boundary Router (ASBR) to inject external routes into an OSPF domain?",
        options: [
          "Type 5 (AS External LSA)",
          "Type 1 (Router LSA)",
          "Type 3 (Summary LSA)",
          "Type 7 (NSSA External LSA)",
        ],
        correctAnswer: "Type 5 (AS External LSA)",
        points: 25,
      },
      {
        assessmentId: activeAssessment.id,
        round: "ROUND_2_CODING",
        category: "CODING",
        targetRole: "Network Engineer",
        title: "Advanced Network Theory: TCP 3-Way Handshake & SYN Flooding Mitigation",
        content:
          "Which security mechanism defends servers against TCP SYN flood denial-of-service attacks by deferring memory allocation for half-open connections until the final ACK arrives?",
        options: [
          "SYN Cookies",
          "Reverse Path Forwarding (uRPF)",
          "TCP Window Scaling",
          "Port Address Translation (PAT)",
        ],
        correctAnswer: "SYN Cookies",
        points: 25,
      },
      {
        assessmentId: activeAssessment.id,
        round: "ROUND_2_CODING",
        category: "PYTHON",
        targetRole: "Network Engineer",
        title: "Network Automation: IPv4 Subnet Calculator",
        content:
          "Write a Python function `calculate_subnet_details(ip_cidr)` that takes an IPv4 CIDR string (e.g. '192.168.1.10/24') and returns a dictionary with:\n- 'network_address': Base network address (e.g. '192.168.1.0')\n- 'broadcast_address': Broadcast address (e.g. '192.168.1.255')\n- 'total_usable_hosts': Total usable client hosts integer (e.g. 254)",
        starterCode: {
          python: "def calculate_subnet_details(ip_cidr):\n    # Write your network automation solution here\n    pass\n",
        },
        testCases: [
          {
            input: "ip_cidr = '192.168.1.10/24'",
            output: "{'network_address': '192.168.1.0', 'broadcast_address': '192.168.1.255', 'total_usable_hosts': 254}",
            isHidden: false,
          },
        ],
        points: 50,
      },
      {
        assessmentId: activeAssessment.id,
        round: "ROUND_2_CODING",
        category: "PYTHON",
        targetRole: "Network Engineer",
        title: "Network Security: Packet Log Anomaly Detection",
        content:
          "Write a Python function `detect_ddos_attempts(packet_logs, rate_limit)` that takes:\n- packet_logs: A list of dicts [{'ip': '10.0.0.1'}, ...]\n- rate_limit: An integer threshold\n\nReturn a sorted list of unique IP addresses whose packet frequency exceeds rate_limit.",
        starterCode: {
          python: "def detect_ddos_attempts(packet_logs, rate_limit):\n    # Write your packet analysis here\n    pass\n",
        },
        testCases: [
          {
            input: "packet_logs=[{'ip': '10.0.0.1'}, {'ip': '10.0.0.1'}, {'ip': '10.0.0.2'}], rate_limit=1",
            output: "['10.0.0.1']",
            isHidden: false,
          },
        ],
        points: 50,
      },
    ];

    for (const q of neDifficultR2) {
      const exists = await prisma.question.findFirst({
        where: { assessmentId: activeAssessment.id, title: q.title },
      });
      if (!exists) {
        await (prisma.question as any).create({ data: q as any });
      }
    }

    // 7. Tag existing software developer coding questions
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

    console.log("✅ Seed complete: All difficult questions for Software Developer, Data Analyst, and Network Engineer are synchronized into the live assessment!");
  } catch (error) {
    console.error("Seeding error:", error);
  }
}
