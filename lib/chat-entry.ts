import type { Job } from "./data";

/** Fields the model found in ONE message (route `extracted`), before merging with an open card. */
export type ExtractedCommitment = {
  customer?: unknown;
  work?: unknown;
  total?: unknown;
  paid?: unknown;
  balance?: unknown;
  date?: unknown;
  time?: unknown;
};

export const sameCustomer = (a?: string | null, b?: string | null) =>
  (a || "").trim().toLocaleLowerCase("en-IN") === (b || "").trim().toLocaleLowerCase("en-IN");

const positive = (value: unknown) => Number.isFinite(Number(value)) && Number(value) > 0;
const text = (value: unknown) => (typeof value === "string" ? value.trim() : "");

/**
 * A message starts a NEW entry only when it names a different customer than the
 * open card AND carries work or an amount. Short answers (only an amount, only a
 * date, or no name at all) keep updating the open card.
 */
export function startsNewEntry(
  pending: Pick<Job, "customer" | "work"> | null,
  currentCustomer: string | null,
  extracted: ExtractedCommitment | null | undefined
): boolean {
  if (!pending?.work?.trim() || !extracted) return false;
  const named = text(extracted.customer);
  if (!named || sameCustomer(named, pending.customer || currentCustomer)) return false;
  return (
    Boolean(text(extracted.work)) ||
    positive(extracted.total) ||
    positive(extracted.paid) ||
    positive(extracted.balance)
  );
}

/** Reuse an existing book's spelling ("asha" -> "Asha") so no duplicate customer is created. */
export const canonicalCustomer = (name: string, known: string[]) =>
  known.find((existing) => sameCustomer(existing, name)) ?? name.trim();

/** A fresh card built from this message only, never mixed with the previous card. */
export function freshEntry(raw: ExtractedCommitment, customer: string, id: string, source: string): Job {
  const amount = (value: unknown) =>
    Number.isFinite(Number(value)) && Number(value) >= 0 ? Number(value) : 0;
  let total = amount(raw.total);
  let paid = amount(raw.paid);
  const balance = amount(raw.balance);
  if (!total && balance) total = paid + balance;
  if (total && balance && !paid) paid = Math.max(0, total - balance);
  return {
    id,
    customer,
    work: text(raw.work),
    total,
    paid,
    date: text(raw.date),
    time: text(raw.time),
    status: "Confirmed",
    source,
    createdAt: new Date().toISOString(),
  };
}

/** The parts of a chat turn the reply strip needs. */
export type ReplyTurn = {
  id: string;
  role: "me" | "assistant";
  customer?: string;
  undoId?: string;
  retryText?: string;
};

/**
 * Which assistant reply the strip in a customer's book shows.
 * - Only replies for this customer count.
 * - A reply with a live action (Try again, or an Undo whose id is the active
 *   replaced entry) is always eligible, even if it arrived before the floor.
 * - A plain reply is shown only if it came after the floor (the last turn when
 *   the entry was opened). If the floor turn is gone, every turn counts.
 * The newest eligible reply wins.
 */
export function pickEntryReply<T extends ReplyTurn>(
  turns: T[],
  customer: string | null,
  floorId: string | null,
  activeUndoId: string | null | undefined
): T | undefined {
  const floor = floorId ? turns.findIndex((turn) => turn.id === floorId) : -1;
  for (let i = turns.length - 1; i >= 0; i--) {
    const turn = turns[i];
    if (turn.role !== "assistant" || (turn.customer ?? null) !== customer) continue;
    const liveUndo = Boolean(turn.undoId) && turn.undoId === activeUndoId;
    const liveRetry = Boolean(turn.retryText);
    if (liveUndo || liveRetry || i > floor) return turn;
  }
  return undefined;
}
