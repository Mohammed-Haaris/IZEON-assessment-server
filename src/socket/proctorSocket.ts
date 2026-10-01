import { Server as SocketIOServer, Socket } from "socket.io";
import prisma from "../lib/prisma";

export function setupProctorSocket(io: SocketIOServer) {
  io.on("connection", (socket: Socket) => {
    // 1. Join room
    socket.on("join:attempt", (attemptId: string) => {
      if (attemptId) {
        socket.join(`attempt:${attemptId}`);
      }
    });

    socket.on("join:admin", () => {
      socket.join("admin_monitor");
    });

    // 2. Student tab switch violation reported
    socket.on(
      "student:tab_switch",
      async (data: { attemptId: string; violationType?: string }) => {
        try {
          const { attemptId, violationType = "TAB_SWITCH" } = data;
          if (!attemptId) return;

          const attempt = await prisma.assessmentAttempt.findUnique({
            where: { id: attemptId },
            include: { user: true, assessment: true },
          });

          if (!attempt) return;
          if (attempt.status === "COMPLETED" || attempt.status === "DISQUALIFIED") return;

          const newCount = attempt.tabSwitchCount + 1;

          // Record malpractice incident log
          const log = await prisma.malpracticeLog.create({
            data: {
              attemptId: attempt.id,
              userId: attempt.userId,
              violationType,
              violationCount: newCount,
              adminDecision: newCount >= 2 ? "PENDING" : null,
            },
          });

          if (newCount === 1) {
            // Strike 1: Update count and send warning
            await prisma.assessmentAttempt.update({
              where: { id: attemptId },
              data: { tabSwitchCount: newCount },
            });

            socket.emit("proctor:warning", {
              count: 1,
              message:
                "Warning 1 of 2: Tab switch detected! One more tab switch will flag you for malpractice and lock your test.",
            });
          } else {
            // Strike 2+: Lock attempt and notify Admin
            const updated = await prisma.assessmentAttempt.update({
              where: { id: attemptId },
              data: {
                tabSwitchCount: newCount,
                status: "MALPRACTICE_LOCKED",
              },
            });

            // Inform the student
            io.to(`attempt:${attemptId}`).emit("proctor:locked", {
              count: newCount,
              message:
                "Assessment locked due to multiple malpractice violations. Administrator has been notified to review your session.",
            });

            // Trigger instant real-time pop-up alert to Admin Dashboard
            io.to("admin_monitor").emit("admin:malpractice_alert", {
              attemptId: attempt.id,
              logId: log.id,
              studentId: attempt.user.id,
              studentName: attempt.user.name,
              studentEmail: attempt.user.email,
              assessmentTitle: attempt.assessment.title,
              violationType,
              violationCount: newCount,
              timestamp: new Date(),
            });
          }
        } catch (error) {
          console.error("Error processing tab switch:", error);
        }
      }
    );

    // 3. Admin decides to "Give Another Chance"
    socket.on(
      "admin:give_chance",
      async (data: { attemptId: string; remarks?: string }) => {
        try {
          const { attemptId, remarks } = data;
          if (!attemptId) return;

          // Reset status to Round 2 and set violation count to 1 (final grace)
          await prisma.assessmentAttempt.update({
            where: { id: attemptId },
            data: {
              status: "ROUND_2_IN_PROGRESS",
              tabSwitchCount: 1,
            },
          });

          // Update pending logs
          await prisma.malpracticeLog.updateMany({
            where: { attemptId, adminDecision: "PENDING" },
            data: {
              adminDecision: "GIVEN_CHANCE",
              adminRemarks: remarks || "Admin granted candidate another chance.",
            },
          });

          // Unblock student screen
          io.to(`attempt:${attemptId}`).emit("proctor:unlocked", {
            message:
              "The administrator has granted you another chance. Please return to fullscreen and do not leave the exam tab.",
          });

          // Notify admins that incident was resolved
          io.to("admin_monitor").emit("admin:action_resolved", {
            attemptId,
            decision: "GIVEN_CHANCE",
          });
        } catch (error) {
          console.error("Error giving chance:", error);
        }
      }
    );

    // 4. Admin decides to "Reject / Disqualify"
    socket.on(
      "admin:reject_student",
      async (data: { attemptId: string; remarks?: string }) => {
        try {
          const { attemptId, remarks } = data;
          if (!attemptId) return;

          await prisma.assessmentAttempt.update({
            where: { id: attemptId },
            data: {
              status: "DISQUALIFIED",
              completedAt: new Date(),
            },
          });

          await prisma.malpracticeLog.updateMany({
            where: { attemptId, adminDecision: "PENDING" },
            data: {
              adminDecision: "REJECTED",
              adminRemarks: remarks || "Disqualified for multiple violations.",
            },
          });

          // Disqualify student screen
          io.to(`attempt:${attemptId}`).emit("proctor:disqualified", {
            message:
              "Your assessment has been disqualified by the administrator due to malpractice violations.",
          });

          // Notify admins
          io.to("admin_monitor").emit("admin:action_resolved", {
            attemptId,
            decision: "REJECTED",
          });
        } catch (error) {
          console.error("Error rejecting student:", error);
        }
      }
    );

    socket.on("disconnect", () => {
      // client disconnected
    });
  });
}
