import webpush from "web-push";
import type { ReminderWorkflowInput } from "../reminder-push";

type StepInput = ReminderWorkflowInput & {
  occurrenceAt: string;
};

type WorkspaceReminder = {
  id?: string;
  text?: string;
  date?: string;
  time?: string;
  customer?: string;
  repeat?: "none" | "daily" | "weekly" | "monthly";
  done?: boolean;
};

export async function sendReminderPush(input: StepInput): Promise<{
  active: boolean;
  repeat: "none" | "daily" | "weekly" | "monthly";
}> {
  "use step";

  const base = process.env.NEXT_PUBLIC_SUPABASE_URL || "";
  const service = process.env.SUPABASE_SERVICE_ROLE_KEY || "";
  const publicKey = process.env.VAPID_PUBLIC_KEY || "";
  const privateKey = process.env.VAPID_PRIVATE_KEY || "";
  const subject = process.env.VAPID_SUBJECT || "mailto:support@zorivo.in";

  if (!base || !service || !publicKey || !privateKey) {
    return { active: false, repeat: "none" };
  }

  const workspaceResponse = await fetch(
    base +
      "/rest/v1/workspaces?owner_id=eq." +
      encodeURIComponent(input.userId) +
      "&select=payload",
    {
      headers: {
        apikey: service,
        Authorization: "Bearer " + service,
      },
    }
  );

  if (!workspaceResponse.ok) {
    throw new Error("Could not verify reminder workspace.");
  }

  const rows = await workspaceResponse.json();
  const reminders: WorkspaceReminder[] = Array.isArray(rows?.[0]?.payload?.reminders)
    ? rows[0].payload.reminders
    : [];

  const reminder = reminders.find((item) => item?.id === input.reminderId);

  if (
    !reminder ||
    reminder.done ||
    reminder.date !== input.expectedDate ||
    (reminder.time || "09:00") !== input.expectedTime
  ) {
    return { active: false, repeat: "none" };
  }

  const repeat =
    reminder.repeat === "daily" ||
    reminder.repeat === "weekly" ||
    reminder.repeat === "monthly"
      ? reminder.repeat
      : "none";

  if (
    !input.subscription?.endpoint ||
    !input.subscription?.keys?.auth ||
    !input.subscription?.keys?.p256dh
  ) {
    return { active: false, repeat };
  }

  webpush.setVapidDetails(subject, publicKey, privateKey);

  const payload = JSON.stringify({
    title: reminder.customer
      ? "Pakki Baat · " + reminder.customer
      : "Pakki Baat reminder",
    body: reminder.text || "You have a reminder.",
    reminderId: reminder.id,
    url: "/",
    occurrenceAt: input.occurrenceAt,
  });

  try {
    await webpush.sendNotification(
      {
        endpoint: input.subscription.endpoint,
        expirationTime: input.subscription.expirationTime ?? null,
        keys: {
          auth: input.subscription.keys.auth,
          p256dh: input.subscription.keys.p256dh,
        },
      },
      payload,
      {
        TTL: 60 * 60 * 24,
        urgency: "high",
      }
    );
  } catch (error) {
    const statusCode =
      typeof error === "object" &&
      error &&
      "statusCode" in error &&
      typeof (error as { statusCode?: unknown }).statusCode === "number"
        ? (error as { statusCode: number }).statusCode
        : 0;

    if (statusCode === 404 || statusCode === 410) {
      return { active: false, repeat };
    }

    throw error;
  }

  return { active: true, repeat };
}
