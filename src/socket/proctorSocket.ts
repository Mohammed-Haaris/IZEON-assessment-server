import { Server as SocketIOServer, Socket } from "socket.io";
import prisma from "../lib/prisma";

const lastSocketTabSwitch = new Map<string, number>();

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

          // Ignore WINDOW_BLUR to prevent false strikes on accidental clicks/editor focuses
          if (violationType === "WINDOW_BLUR") {
            return;
          }

          const now = Date.now();
          const lastTime = lastSocketTabSwitch.get(attemptId) || 0;
          if (now - lastTime < 1000) {
            return;
          }
          lastSocketTabSwitch.set(attemptId, now);

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
            await prisma.assessmentAttempt.update({
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

            // Trigger instant real-time alert to Admin Dashboard
            io.to("admin_monitor").emit("admin:malpractice_alert", alertPayload);
            io.emit("admin:malpractice_alert", alertPayload);
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

          // Reset status to appropriate round and set violation count to 1 (final grace)
          const targetAttempt = await prisma.assessmentAttempt.findUnique({
            where: { id: attemptId },
          });
          const restoredStatus =
            targetAttempt?.currentRound === "ROUND_1_APTITUDE_VERBAL_WRITTEN"
              ? "ROUND_1_IN_PROGRESS"
              : "ROUND_2_IN_PROGRESS";

          await prisma.assessmentAttempt.update({
            where: { id: attemptId },
            data: {
              status: restoredStatus,
              tabSwitchCount: 1,
            },
          });

          // Update pending logs
          await prisma.malpracticeLog.updateMany({
            where: {
              attemptId,
              OR: [{ adminDecision: "PENDING" }, { adminDecision: null }, { adminDecision: "" }],
            },
            data: {
              adminDecision: "GIVEN_CHANCE",
              adminRemarks: remarks || "Admin granted candidate another chance.",
            },
          });

          // Unblock student screen
          const unlockData = {
            attemptId,
            message:
              "The administrator has granted you another chance. Please return to fullscreen and do not leave the exam tab.",
          };
          io.to(`attempt:${attemptId}`).emit("proctor:unlocked", unlockData);
          io.emit("proctor:unlocked", unlockData);

          // Notify admins that incident was resolved
          io.to("admin_monitor").emit("admin:action_resolved", {
            attemptId,
            decision: "GIVEN_CHANCE",
          });
          io.emit("admin:action_resolved", {
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
            where: {
              attemptId,
              OR: [{ adminDecision: "PENDING" }, { adminDecision: null }, { adminDecision: "" }],
            },
            data: {
              adminDecision: "REJECTED",
              adminRemarks: remarks || "Disqualified for multiple violations.",
            },
          });

          // Disqualify student screen
          const disqData = {
            attemptId,
            message:
              "Your assessment has been disqualified by the administrator due to malpractice violations.",
          };
          io.to(`attempt:${attemptId}`).emit("proctor:disqualified", disqData);
          io.emit("proctor:disqualified", disqData);

          // Notify admins
          io.to("admin_monitor").emit("admin:action_resolved", {
            attemptId,
            decision: "REJECTED",
          });
          io.emit("admin:action_resolved", {
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
