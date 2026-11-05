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
