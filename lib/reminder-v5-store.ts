import type { ValidatedScheduleRequest } from "./push-schedule-security";

type WorkspaceReminder = { id?: string; date?: string; time?: string; done?: boolean; scheduler?: string };
export type V5Schedule = { scheduleId: string; generation: number; shouldStart: boolean };

function headers(service: string) {
  return { apikey: service, Authorization: "Bearer " + service, "Content-Type": "application/json" };
}

export async function ensureV5Schedule(userId: string, request: ValidatedScheduleRequest): Promise<V5Schedule | null> {
  const base = process.env.NEXT_PUBLIC_SUPABASE_URL || "";
  const service = process.env.SUPABASE_SERVICE_ROLE_KEY || "";
  if (!base || !service) throw new Error("Reminder scheduler storage is not configured.");

  // This is the server-side ownership gate. A missing marker is legacy-v4,
  // even if an old browser calls this endpoint directly.
  const workspace = await fetch(base + "/rest/v1/workspaces?owner_id=eq." + encodeURIComponent(userId) + "&select=payload", { headers: headers(service) });
  if (!workspace.ok) throw new Error("Could not verify reminder ownership.");
  const rows = await workspace.json();
  const reminders: WorkspaceReminder[] = Array.isArray(rows?.[0]?.payload?.reminders) ? rows[0].payload.reminders : [];
  const reminder = reminders.find((item) => item?.id === request.reminder.id);
  if (!reminder || reminder.scheduler !== "v5" || reminder.done || reminder.date !== request.reminder.date || (reminder.time || "09:00") !== (request.reminder.time || "09:00")) return null;

  const reply = await fetch(base + "/rest/v1/rpc/ensure_v5_reminder_schedule", {
    method: "POST", headers: headers(service),
    body: JSON.stringify({
      p_owner_id: userId, p_reminder_id: request.reminder.id, p_expected_date: request.reminder.date,
      p_expected_time: request.reminder.time || "09:00", p_subscription_fingerprint: await subscriptionFingerprint(request.subscription),
    }),
  });
  if (!reply.ok) throw new Error("Could not reserve the reminder schedule.");
  const result = await reply.json();
  if (result?.reason === "delivery_disabled") throw new Error("Workflow 5 reminder delivery is temporarily disabled.");
  if (typeof result?.schedule_id !== "string" || !Number.isSafeInteger(result?.generation) || typeof result?.should_start !== "boolean") throw new Error("Invalid reminder schedule response.");
  return { scheduleId: result.schedule_id, generation: result.generation, shouldStart: result.should_start };
}

export async function recordV5WorkflowStart(scheduleId: string, generation: number, runId: string) {
  const base = process.env.NEXT_PUBLIC_SUPABASE_URL || "";
  const service = process.env.SUPABASE_SERVICE_ROLE_KEY || "";
  if (!base || !service) return;
  await fetch(base + "/rest/v1/rpc/record_v5_reminder_workflow_start", {
    method: "POST", headers: headers(service), body: JSON.stringify({ p_schedule_id: scheduleId, p_generation: generation, p_run_id: runId }),
  });
}

async function subscriptionFingerprint(subscription: ValidatedScheduleRequest["subscription"]) {
  const value = JSON.stringify({ endpoint: subscription.endpoint, auth: subscription.keys.auth, p256dh: subscription.keys.p256dh });
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, "0")).join("");
}
