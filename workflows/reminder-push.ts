import { sleep } from "workflow";
import { sendReminderPush } from "./steps/send-reminder-push";

export type ReminderPushSubscription = {
  endpoint: string;
  expirationTime?: number | null;
  keys?: {
    auth?: string;
    p256dh?: string;
  };
};

export type ReminderWorkflowInput = {
  userId: string;
  reminderId: string;
  expectedDate: string;
  expectedTime: string;
  remindAt: string;
  subscription: ReminderPushSubscription;
};

function nextOccurrence(date: Date, repeat: "daily" | "weekly" | "monthly") {
  const next = new Date(date);
  if (repeat === "daily") next.setUTCDate(next.getUTCDate() + 1);
  if (repeat === "weekly") next.setUTCDate(next.getUTCDate() + 7);
  if (repeat === "monthly") next.setUTCMonth(next.getUTCMonth() + 1);
  return next;
}

export async function reminderPushWorkflow(input: ReminderWorkflowInput) {
  "use workflow";

  let nextAt = new Date(input.remindAt);

  while (true) {
    await sleep(nextAt);

    const result = await sendReminderPush({
      ...input,
      occurrenceAt: nextAt.toISOString(),
    });

    if (!result.active || result.repeat === "none") {
      return result;
    }

    nextAt = nextOccurrence(nextAt, result.repeat);
  }
}
