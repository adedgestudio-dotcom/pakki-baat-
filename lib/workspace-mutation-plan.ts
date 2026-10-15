import { type CustomerNote, type Job, type Payment, type Reminder, type Snapshot } from "./data";
import { buildWorkspaceSnapshot } from "./workspace-transaction";

export type WorkspaceMutationOperation =
  | { kind: "profile"; owner: string; business: string }
  | { kind: "phone"; customer: string; phone: string | null }
  | { kind: "upsert-job"; job: Job; payment?: Payment }
  | { kind: "append-payment"; payment: Payment; jobId: string; paid: number }
  | { kind: "upsert-reminder"; reminder: Reminder }
  | { kind: "append-note"; note: CustomerNote }
  | { kind: "append-note-if-missing"; note: CustomerNote }
  | { kind: "set-job-status"; jobId: string; status: Job["status"] }
  | { kind: "delete-job"; jobId: string }
  | { kind: "remove-job-only"; jobId: string }
  | { kind: "delete-customer"; customer: string }
  | { kind: "delete-reminder"; reminderId: string }
  | { kind: "complete-reminder"; reminderId: string }
  | { kind: "snooze-reminder"; reminderId: string }
  | { kind: "replace-jobs"; jobs: Job[] }
  | { kind: "replace-snapshot"; snapshot: Snapshot; destructive: true };
export type WorkspacePlan = { accepted: true; snapshot: Snapshot; requiresVerifiedBackup: boolean } | { accepted: false; reason: string };
export type SpecialWorkspaceOperation = "reminder-immediate-cloud" | "undo" | "import-restore" | "pre-operation-backup";
export type SpecialWorkspacePolicy = { action: "defer" | "block"; reason: string };

/** Pure structural planner: validation and payment/plan rules stay with their existing handlers. */
export function planWorkspaceMutation(current: Snapshot, operation: WorkspaceMutationOperation): WorkspacePlan {
  try {
    let requiresVerifiedBackup = false;
    const snapshot = buildWorkspaceSnapshot(current, draft => {
      const next = { ...draft, reminders: draft.reminders || [], payments: draft.payments || [], notes: draft.notes || [], customerPhones: draft.customerPhones || {} };
      switch (operation.kind) {
        case "profile": return { ...next, owner: operation.owner, business: operation.business };
        case "phone": { const customerPhones = { ...next.customerPhones }; if (operation.phone) customerPhones[operation.customer] = operation.phone; else delete customerPhones[operation.customer]; return { ...next, customerPhones }; }
        case "upsert-job": return { ...next, jobs: [operation.job, ...next.jobs.filter(job => job.id !== operation.job.id)], payments: operation.payment ? [operation.payment, ...next.payments.filter(payment => payment.id !== operation.payment!.id)] : next.payments };
        case "append-payment": {
          if (!next.jobs.some(job => job.id === operation.jobId)) throw new Error("Payment job does not exist.");
          if (next.payments.some(payment => payment.id === operation.payment.id)) throw new Error("Duplicate payment ID.");
          return { ...next, jobs: next.jobs.map(job => job.id === operation.jobId ? { ...job, paid: operation.paid } : job), payments: [operation.payment, ...next.payments] };
        }
        case "upsert-reminder": return { ...next, reminders: [operation.reminder, ...next.reminders.filter(reminder => reminder.id !== operation.reminder.id)] };
        case "append-note": return { ...next, notes: [operation.note, ...next.notes] };
        case "append-note-if-missing": return next.notes.some(note => note.customer === operation.note.customer) ? next : { ...next, notes: [operation.note, ...next.notes] };
        case "set-job-status": return { ...next, jobs: next.jobs.map(job => job.id === operation.jobId ? { ...job, status: operation.status } : job) };
        case "delete-job": requiresVerifiedBackup = true; return { ...next, jobs: next.jobs.filter(job => job.id !== operation.jobId), payments: next.payments.filter(payment => payment.jobId !== operation.jobId), reminders: next.reminders.filter(reminder => reminder.jobId !== operation.jobId) };
        case "remove-job-only": requiresVerifiedBackup = true; return { ...next, jobs: next.jobs.filter(job => job.id !== operation.jobId) };
        case "delete-customer": { requiresVerifiedBackup = true; const jobIds = new Set(next.jobs.filter(job => job.customer === operation.customer).map(job => job.id)); const customerPhones = { ...next.customerPhones }; delete customerPhones[operation.customer]; return { ...next, jobs: next.jobs.filter(job => job.customer !== operation.customer), payments: next.payments.filter(payment => payment.customer !== operation.customer && (!payment.jobId || !jobIds.has(payment.jobId))), reminders: next.reminders.filter(reminder => reminder.customer !== operation.customer && (!reminder.jobId || !jobIds.has(reminder.jobId))), notes: next.notes.filter(note => note.customer !== operation.customer), customerPhones }; }
        case "delete-reminder": requiresVerifiedBackup = true; return { ...next, reminders: next.reminders.filter(reminder => reminder.id !== operation.reminderId) };
        case "complete-reminder": return { ...next, reminders: next.reminders.map(reminder => {
          if (reminder.id !== operation.reminderId) return reminder;
          if (!reminder.repeat || reminder.repeat === "none") return { ...reminder, done: true };
          const date = new Date(reminder.date + "T12:00:00");
          if (reminder.repeat === "daily") date.setDate(date.getDate() + 1);
          if (reminder.repeat === "weekly") date.setDate(date.getDate() + 7);
          if (reminder.repeat === "monthly") date.setMonth(date.getMonth() + 1);
          return { ...reminder, date: `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`, done: false };
        }) };
        case "snooze-reminder": return { ...next, reminders: next.reminders.map(reminder => {
          if (reminder.id !== operation.reminderId) return reminder;
          const date = new Date(reminder.date + "T12:00:00"); date.setDate(date.getDate() + 1);
          return { ...reminder, date: `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}` };
        }) };
        case "replace-jobs": return { ...next, jobs: operation.jobs };
        case "replace-snapshot": requiresVerifiedBackup = true; return operation.snapshot;
      }
    });
    return { accepted: true, snapshot, requiresVerifiedBackup };
  } catch (error) { return { accepted: false, reason: error instanceof Error ? error.message : "Workspace operation is invalid." }; }
}

/** No special workflow may issue a cloud write until a journal-aware coordinator is integrated. */
export function decideSpecialWorkspaceOperation(operation: SpecialWorkspaceOperation): SpecialWorkspacePolicy {
  if (operation === "pre-operation-backup") return { action: "defer", reason: "Create the backup only after a journal-aware save coordinator confirms the snapshot." };
  return { action: "block", reason: "This workflow needs a journal-aware cloud/backup state machine before it can mutate the workspace." };
}
