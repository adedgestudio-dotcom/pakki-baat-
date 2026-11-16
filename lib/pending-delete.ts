import type { Snapshot } from "./data";

export type PendingDelete = { type: "entry" | "customer"; id: string };

export function withoutPendingDelete(snapshot: Snapshot, pending: PendingDelete | null): Snapshot {
  if (!pending) return snapshot;
  const jobIds = new Set(snapshot.jobs.filter(job => pending.type === "entry" ? job.id === pending.id : job.customer === pending.id).map(job => job.id));
  const customer = pending.type === "customer" ? pending.id : null;
  return {
    ...snapshot,
    jobs: snapshot.jobs.filter(job => !jobIds.has(job.id)),
    payments: snapshot.payments?.filter(payment => (!customer || payment.customer !== customer) && (!payment.jobId || !jobIds.has(payment.jobId))),
    reminders: snapshot.reminders?.filter(reminder => (!customer || reminder.customer !== customer) && (!reminder.jobId || !jobIds.has(reminder.jobId))),
    notes: snapshot.notes?.filter(note => !customer || note.customer !== customer),
    customerPhones: customer ? Object.fromEntries(Object.entries(snapshot.customerPhones || {}).filter(([name]) => name !== customer)) : snapshot.customerPhones,
  };
}

export function createPendingDeleteController(apply: (pending: PendingDelete) => void, changed: (pending: PendingDelete | null) => void, schedule = setTimeout, cancel = clearTimeout) {
  let pending: PendingDelete | null = null;
  let timer: ReturnType<typeof setTimeout> | undefined;
  function clear() {
    if (timer !== undefined) cancel(timer);
    timer = undefined;
    const previous = pending;
    pending = null;
    if (previous) changed(null);
    return previous;
  }
  function flush() { const previous = clear(); if (previous) apply(previous); return Boolean(previous); }
  return {
    start(next: PendingDelete) { flush(); pending = next; changed(next); timer = schedule(flush, 10_000); },
    undo() { clear(); },
    flush,
  };
}
