import { sleep } from "workflow";
import { sendReminderPush } from "./steps/send-reminder-push";
import { claimV5Runner } from "./steps/reminder-v5-ledger";

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
  scheduleId: string;
  generation: number;
  runnerId: string;
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

  // Multiple starts can occur if a server dies after Vercel accepted start but
  // before the database acknowledgement. Only one run obtains this durable
  // ownership claim; all other deployment-pinned V5 runs become harmless.
  if (!(await claimV5Runner(input.scheduleId, input.generation, input.runnerId))) return { active: false, repeat: "none" };

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
