import type { Snapshot } from "./data";

export type LedgerRow = {
  id: string; owner_id: string; job_id: string | null; customer_name: string;
  transaction_kind: "charge" | "payment" | "reversal" | "adjustment" | "opening_balance";
  amount_paise: number | string; occurred_at: string; reverses_transaction_id: string | null;
  metadata: Record<string, unknown>;
};
export type ReportTransaction = {
  id: string; customer: string; kind: string; amountPaise: number;
  day: string; description: string; historical: boolean;
  salesEffect: number; paymentEffect: number;
  unclassified?: boolean;
};
export type Report = { rows: ReportTransaction[]; warnings: string[]; activeOutstandingPaise: number };
export type ReportFilter = { from: string; to: string; search: string; kind: string; sort: "date" | "amount" | "customer"; descending: boolean };
export const defaultReportFilter: ReportFilter = { from: "", to: "", search: "", kind: "all", sort: "date", descending: true };
export const formatReportMoney = (paise: number) => new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", minimumFractionDigits: 2 }).format(paise / 100);
function integer(value: number | string) {
  if (typeof value === "string" && !/^\d+$/.test(value)) throw Error("Invalid ledger amount.");
  const amount = Number(value);
  if (!Number.isSafeInteger(amount) || amount <= 0) throw Error("Invalid ledger amount.");
  return amount;
}
function sum(values: number[]) {
  return values.reduce((total, value) => {
    const next = total + value;
    if (!Number.isSafeInteger(next)) throw Error("Report total exceeds safe currency precision.");
    return next;
  }, 0);
}
function paise(value: number) {
  const result = Math.round(value * 100);
  if (!Number.isFinite(value) || value < 0 || !Number.isSafeInteger(result) || Math.abs(value * 100 - result) > 0.00001) throw Error("Workspace contains an invalid monetary value.");
  return result;
}
export function validReportDay(value: string) {
  return /^\d{4}-\d{2}-\d{2}$/.test(value) && Number.isFinite(Date.parse(value)) && new Date(value).toISOString().slice(0, 10) === value;
}
function utcDay(value: string) {
  if (!Number.isFinite(Date.parse(value))) throw Error("Transaction has an invalid timestamp.");
  return new Date(value).toISOString().slice(0, 10);
}
function activeOutstanding(snapshot: Snapshot) {
  return sum(snapshot.jobs.map(job => paise(Math.max(0, job.total - job.paid))));
}
export function ledgerReport(input: LedgerRow[], ownerId: string, snapshot: Snapshot): Report {
  const byId = new Map<string, LedgerRow>();
  for (const row of input) {
    if (row.owner_id !== ownerId) throw Error("Report belongs to another account.");
    if (!row.id || byId.has(row.id)) throw Error("Ledger has duplicate or missing IDs. Reload Reports.");
    integer(row.amount_paise);
    if (!["charge", "payment", "reversal", "adjustment", "opening_balance"].includes(row.transaction_kind)) throw Error("Unsupported ledger transaction kind; totals are unavailable.");
    byId.set(row.id, row);
  }
  const activeIds = new Set(snapshot.jobs.map(job => job.id));
  const reversed = new Map<string, number>();
  const warnings = new Set<string>();
  const rows = input.map(row => {
    const amount = integer(row.amount_paise);
    let basis = row.transaction_kind;
    let sign = 1;
    let description = typeof row.metadata?.reason === "string" ? row.metadata.reason.replaceAll("_", " ") : "Ledger transaction";
    if (basis === "reversal") {
      const original = byId.get(row.reverses_transaction_id || "");
      if (!original || original.transaction_kind === "reversal") throw Error("A reversal is missing its original transaction. Totals are unavailable.");
      const total = sum([reversed.get(original.id) || 0, amount]);
      if (total > integer(original.amount_paise)) throw Error("Ledger contains an excessive reversal.");
      reversed.set(original.id, total);
      basis = original.transaction_kind;
      sign = -1;
      description = `Reverses ${basis} ${original.id}. ${description}. A correction reversal is not a cash refund.`;
    }
    const unclassified = !["charge", "payment"].includes(basis);
    if (unclassified) {
      warnings.add("Adjustment/opening-balance direction is not defined by this schema. These rows are shown but summary totals are incomplete; do not use this report as a reconciled balance.");
      description += ". Unclassified accounting direction; excluded from net totals.";
    }
    const correction = row.metadata?.reason === "payment_edit" || row.metadata?.reason === "job_edit";
    return {
      id: row.id, customer: row.customer_name, kind: row.transaction_kind === "reversal" ? "reversal" : correction ? "correction" : row.transaction_kind,
      amountPaise: amount, day: utcDay(row.occurred_at), description: correction ? `Replacement ${basis}. ${description}` : description,
      historical: !row.job_id || !activeIds.has(row.job_id),
      unclassified,
      salesEffect: basis === "charge" ? amount * sign : 0,
      paymentEffect: basis === "payment" ? amount * sign : 0,
    };
  });
  const jobEffects = new Map<string, { sales: number; payments: number }>();
  rows.forEach((row, index) => {
    const id = input[index].job_id;
    if (!id) return;
    const previous = jobEffects.get(id) || { sales: 0, payments: 0 };
    jobEffects.set(id, { sales: sum([previous.sales, row.salesEffect]), payments: sum([previous.payments, row.paymentEffect]) });
  });
  if (snapshot.jobs.some(job => {
    const effects = jobEffects.get(job.id) || { sales: 0, payments: 0 };
    return effects.sales !== paise(job.total) || effects.payments !== paise(job.paid);
  })) warnings.add("Active workspace amounts do not reconcile with the loaded ledger. Save may be pending; refresh history after cloud saving completes. No totals have been substituted from workspace amounts.");
  return { rows, warnings: [...warnings], activeOutstandingPaise: activeOutstanding(snapshot) };
}
export function legacyReport(snapshot: Snapshot): Report {
  const warnings = ["Legacy snapshot report: deleted records and earlier corrections cannot be reconstructed. This is not an immutable transaction audit."];
  const activeIds = new Set(snapshot.jobs.map(job => job.id));
  const rows: ReportTransaction[] = [];
  for (const job of snapshot.jobs) {
    const day = job.createdAt ? utcDay(job.createdAt) : job.date;
    if (!validReportDay(day)) warnings.push("A legacy job has no usable date and is omitted from dated totals.");
    else rows.push({ id: `job:${job.id}`, customer: job.customer, kind: "charge", amountPaise: paise(job.total), day, description: `${job.work}${job.createdAt ? "" : " (legacy work date; creation date unavailable)"}`, historical: false, salesEffect: paise(job.total), paymentEffect: 0 });
    const linked = sum((snapshot.payments || []).filter(p => p.jobId === job.id).map(p => paise(p.amount)));
    if (linked !== paise(job.paid)) warnings.push("Job received amounts do not reconcile with linked payment history. No missing payment transactions have been invented.");
  }
  for (const payment of snapshot.payments || []) {
    if (!validReportDay(payment.date)) throw Error("Legacy payment has an invalid date.");
    rows.push({ id: `payment:${payment.id}`, customer: payment.customer, kind: "payment", amountPaise: paise(payment.amount), day: payment.date, description: payment.note || "Payment", historical: !payment.jobId || !activeIds.has(payment.jobId), salesEffect: 0, paymentEffect: paise(payment.amount) });
  }
  if (new Set(rows.map(row => row.id)).size !== rows.length) throw Error("Legacy records contain duplicate IDs; totals are unavailable.");
  return { rows, warnings: [...new Set(warnings)], activeOutstandingPaise: activeOutstanding(snapshot) };
}
export function selectReport(report: Report, filter: ReportFilter) {
  if ((filter.from && !validReportDay(filter.from)) || (filter.to && !validReportDay(filter.to)) || (filter.from && filter.to && filter.from > filter.to)) throw Error("Choose a valid From / To date range.");
  const period = report.rows.filter(row => (!filter.from || row.day >= filter.from) && (!filter.to || row.day <= filter.to));
  const sales = sum(period.map(row => row.salesEffect)), payments = sum(period.map(row => row.paymentEffect));
  const query = filter.search.trim().toLowerCase();
  const numericQuery = query.replace(/[₹,\s]/g, "");
  const rows = period.filter(row => (filter.kind === "all" || row.kind === filter.kind) && (!query || row.customer.toLowerCase().includes(query) || String(row.amountPaise / 100).includes(numericQuery) && numericQuery !== ""));
  rows.sort((a, b) => {
    const result = filter.sort === "amount" ? a.amountPaise - b.amountPaise : filter.sort === "customer" ? a.customer.localeCompare(b.customer) : a.day.localeCompare(b.day);
    return (result || a.id.localeCompare(b.id)) * (filter.descending ? -1 : 1);
  });
  return { rows, sales, payments, periodBalance: sum([sales, -payments]) };
}
export function reportCsv(rows: ReportTransaction[]) {
  const cell = (value: string) => '"' + (!/^-?\d+(?:\.\d+)?$/.test(value) && /^[\s]*[=+\-@\t\r]/.test(value) ? "'" : "") + value.replaceAll('"', '""') + '"';
  return '\uFEFF' + ["Date (UTC),Customer,Type,Amount INR,Sales effect INR,Payment effect INR,History,Description", ...rows.map(row => [row.day, row.customer, row.kind, (row.amountPaise / 100).toFixed(2), row.unclassified ? "" : (row.salesEffect / 100).toFixed(2), row.unclassified ? "" : (row.paymentEffect / 100).toFixed(2), row.historical ? "Historical / unlinked" : "Active work", row.description].map(cell).join(","))].join("\r\n");
}
