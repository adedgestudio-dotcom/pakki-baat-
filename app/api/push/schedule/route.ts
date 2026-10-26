import { start } from "workflow/api";
import { reminderPushWorkflow } from "@/workflows/reminder-push";
import {
  readBoundedJson,
  reserveSchedule,
  scheduleReservationKey,
  validateScheduleRequest,
} from "@/lib/push-schedule-security";
import { ensureV5Schedule, recordV5WorkflowStart } from "@/lib/reminder-v5-store";

export const runtime = "nodejs";

async function authenticatedUserId(request: Request) {
  const base = process.env.NEXT_PUBLIC_SUPABASE_URL || "";
  const publicKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || "";
  const auth = request.headers.get("authorization") || "";

  if (!base || !publicKey || !auth.startsWith("Bearer ")) {
    return null;
  }

  const response = await fetch(base + "/auth/v1/user", {
    headers: {
      apikey: publicKey,
      Authorization: auth,
    },
  });

  if (!response.ok) return null;
  const user = await response.json();
  return typeof user?.id === "string" ? user.id : null;
}

export async function POST(request: Request) {
  const userId = await authenticatedUserId(request);
  if (!userId) {
    return Response.json({ error: "Sign in to enable closed-app reminders." }, { status: 401 });
  }

  if (!process.env.VAPID_PUBLIC_KEY || !process.env.VAPID_PRIVATE_KEY) {
    return Response.json(
      { error: "Closed-app push notifications are not configured yet." },
      { status: 503 }
    );
  }

  const scheduleRequest = validateScheduleRequest(await readBoundedJson(request));
  if (!scheduleRequest) {
    return Response.json({ error: "Invalid reminder push request." }, { status: 400 });
  }

  const reservation = reserveSchedule(userId, scheduleReservationKey(userId, scheduleRequest));
  if (!reservation.ok) {
    if (reservation.reason === "duplicate") {
      return Response.json({ ok: true, duplicate: true }, { status: 202 });
    }
    return Response.json(
      { error: "Too many reminder schedules. Please try again later." },
      { status: 429, headers: { "Retry-After": String(reservation.retryAfterSeconds) } }
    );
  }

  try {
    const schedule = await ensureV5Schedule(userId, scheduleRequest);
    if (!schedule) {
      reservation.release();
      return Response.json({ error: "This legacy reminder remains owned by Workflow 4." }, { status: 409 });
    }
    if (!schedule.shouldStart) return Response.json({ ok: true, duplicate: true, scheduleId: schedule.scheduleId }, { status: 202 });
    const run = await start(reminderPushWorkflow, [
      {
        userId,
        reminderId: scheduleRequest.reminder.id,
        expectedDate: scheduleRequest.reminder.date,
        expectedTime: scheduleRequest.reminder.time || "09:00",
        remindAt: scheduleRequest.due.toISOString(),
        subscription: scheduleRequest.subscription,
        scheduleId: schedule.scheduleId,
        generation: schedule.generation,
        runnerId: crypto.randomUUID(),
      },
    ]);
    // This is advisory only: if the response is lost, duplicate starts still
    // contend on the durable runner claim before any notification is sent.
    await recordV5WorkflowStart(schedule.scheduleId, schedule.generation, run.runId);

    return Response.json({ ok: true, runId: run.runId });
  } catch (error) {
    reservation.release();
    // A known failed start is safe to retry. Unknown outcomes are deliberately
    // left to the runner claim rather than assuming no Workflow was created.
    throw error;
  }
}
