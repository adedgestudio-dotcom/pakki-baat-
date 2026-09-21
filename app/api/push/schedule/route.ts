import { start } from "workflow/api";
import { reminderPushWorkflow, type ReminderPushSubscription } from "@/workflows/reminder-push";

export const runtime = "nodejs";

type ReminderBody = {
  id?: string;
  date?: string;
  time?: string;
};

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

  const body = await request.json().catch(() => null);
  const reminder = (body?.reminder || {}) as ReminderBody;
  const subscription = body?.subscription as ReminderPushSubscription | undefined;
  const remindAt = String(body?.remindAt || "");

  if (
    !reminder.id ||
    !/^\d{4}-\d{2}-\d{2}$/.test(reminder.date || "") ||
    (reminder.time && !/^\d{2}:\d{2}$/.test(reminder.time)) ||
    !subscription?.endpoint ||
    !subscription.keys?.auth ||
    !subscription.keys?.p256dh
  ) {
    return Response.json({ error: "Invalid reminder push request." }, { status: 400 });
  }

  const due = new Date(remindAt);
  if (!Number.isFinite(due.getTime())) {
    return Response.json({ error: "Invalid reminder time." }, { status: 400 });
  }

  const run = await start(reminderPushWorkflow, [
    {
      userId,
      reminderId: reminder.id,
      expectedDate: reminder.date!,
      expectedTime: reminder.time || "09:00",
      remindAt: due.toISOString(),
      subscription,
    },
  ]);

  return Response.json({ ok: true, runId: run.runId });
}
