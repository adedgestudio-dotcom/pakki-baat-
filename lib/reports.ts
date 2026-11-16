import { formatMoneyPaise, paiseDecimal } from "./money";
import type { Payment, Snapshot } from "./data";

export type LedgerRow = {
  id: string; owner_id: string; job_id: string | null; customer_name: string;
  transaction_kind: "charge" | "payment" | "reversal" | "adjustment" | "opening_balance";
  amount_paise: number | string; occurred_at: string; reverses_transaction_id: string | null;
  metadata: Record<string, unknown>;
};
export type ReportTransaction = {
  id: string; customer: string; kind: string; amountPaise: number;
  day: string; sortAt: number; description: string; historical: boolean;
  salesEffect: number; paymentEffect: number;
  unclassified?: boolean;
};
export type Report = { rows: ReportTransaction[]; warnings: string[]; activeOutstandingPaise: number };
export type ReportFilter = { from: string; to: string; search: string; kind: string; sort: "date" | "amount" | "customer"; descending: boolean };
export const defaultReportFilter: ReportFilter = { from: "", to: "", search: "", kind: "all", sort: "date", descending: true };
export const formatReportMoney = formatMoneyPaise;
export type ReportEntry = {
  id: string; customer: string; work: string; day: string; sortAt: number;
  totalPaise: number; receivedPaise: number; pendingPaise: number;
  payments: Payment[]; unlinked: boolean;
};

export function selectReportEntries(snapshot: Snapshot, filter: ReportFilter): ReportEntry[] {
  if ((filter.from && !validReportDay(filter.from)) || (filter.to && !validReportDay(filter.to)) || (filter.from && filter.to && filter.from > filter.to)) throw Error("Choose a valid From / To date range.");
  const ids = new Set(snapshot.jobs.map(job => job.id));
  const payments = snapshot.payments || [];
  const byJob = new Map<string, Payment[]>();
  for (const payment of payments) if (payment.jobId && ids.has(payment.jobId)) {
    const linked = byJob.get(payment.jobId) || [];
    linked.push(payment);
    byJob.set(payment.jobId, linked);
  }
  const paymentOrder = (a: Payment, b: Payment) => a.date.localeCompare(b.date) || (Date.parse(a.createdAt) || 0) - (Date.parse(b.createdAt) || 0) || a.id.localeCompare(b.id);
  const rows: ReportEntry[] = snapshot.jobs.map(job => {
    const day = validReportDay(job.date) ? job.date : job.createdAt && Number.isFinite(Date.parse(job.createdAt)) ? utcDay(job.createdAt) : "";
    const totalPaise = paise(job.total), receivedPaise = paise(job.paid);
    return { id: `job:${job.id}`, customer: job.customer, work: job.work, day, sortAt: Date.parse(job.createdAt || "") || 0, totalPaise, receivedPaise, pendingPaise: Math.max(0, totalPaise - receivedPaise), payments: (byJob.get(job.id) || []).sort(paymentOrder), unlinked: false };
  });
  for (const payment of payments) {
    if (payment.jobId && ids.has(payment.jobId)) continue;
    if (!validReportDay(payment.date)) throw Error("Legacy payment has an invalid date.");
    rows.push({ id: `payment:${payment.id}`, customer: payment.customer, work: "Payment received", day: payment.date, sortAt: Date.parse(payment.createdAt || "") || 0, totalPaise: 0, receivedPaise: paise(payment.amount), pendingPaise: 0, payments: [payment], unlinked: true });
  }
  const query = filter.search.trim().toLocaleLowerCase();
  const numeric = query.replace(/[₹,\s]/g, "");
  const result = rows.filter(row => (!filter.from || row.day >= filter.from) && (!filter.to || row.day <= filter.to)
    && (filter.kind === "all" || filter.kind === "pending_sales" && !row.unlinked && row.pendingPaise > 0 || filter.kind === "fully_paid" && !row.unlinked && row.totalPaise > 0 && row.pendingPaise === 0)
    && (!query || `${row.customer} ${row.work}`.toLocaleLowerCase().includes(query) || /^\d+(?:\.\d+)?$/.test(numeric) && [row.totalPaise, row.receivedPaise, row.pendingPaise].some(value => String(value / 100).includes(numeric))));
  result.sort((a, b) => {
    const primary = filter.sort === "amount" ? a.totalPaise - b.totalPaise : filter.sort === "customer" ? a.customer.localeCompare(b.customer) : a.day.localeCompare(b.day);
    return (primary || a.day.localeCompare(b.day) || a.sortAt - b.sortAt || a.id.localeCompare(b.id)) * (filter.descending ? -1 : 1);
  });
  return result;
}

export function reportEntriesCsv(rows: ReportEntry[]) {
  const cell = (value: string) => '"' + (!/^-?\d+(?:\.\d+)?$/.test(value) && /^[\s]*[=+\-@\t\r]/.test(value) ? "'" : "") + value.replaceAll('"', '""') + '"';
  return '\uFEFF' + ["Date,Customer,Work,Total,Received,Pending", ...rows.map(row => [row.day, row.customer, row.work, paiseDecimal(row.totalPaise), paiseDecimal(row.receivedPaise), paiseDecimal(row.pendingPaise)].map(cell).join(","))].join("\r\n");
}
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
      amountPaise: amount, day: utcDay(row.occurred_at), sortAt: Date.parse(row.occurred_at), description: correction ? `Replacement ${basis}. ${description}` : description,
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
  const warnings: string[] = [];
  const activeIds = new Set(snapshot.jobs.map(job => job.id));
  const rows: ReportTransaction[] = [];
  for (const job of snapshot.jobs) {
    const createdAt = Date.parse(job.createdAt || "");
    const day = Number.isFinite(createdAt) ? utcDay(job.createdAt!) : validReportDay(job.date) ? job.date : "";
    rows.push({ id: `job:${job.id}`, customer: job.customer, kind: "charge", amountPaise: paise(job.total), day, sortAt: Number.isFinite(createdAt) ? createdAt : day ? Date.parse(`${day}T00:00:00Z`) : 0, description: job.work, historical: false, salesEffect: paise(job.total), paymentEffect: 0 });
  }
  for (const payment of snapshot.payments || []) {
    if (!validReportDay(payment.date)) throw Error("Legacy payment has an invalid date.");
    const createdAt = Date.parse(payment.createdAt || "");
    rows.push({ id: `payment:${payment.id}`, customer: payment.customer, kind: "payment", amountPaise: paise(payment.amount), day: payment.date, sortAt: Number.isFinite(createdAt) ? createdAt : Date.parse(`${payment.date}T00:00:00Z`), description: payment.note || "Payment", historical: !payment.jobId || !activeIds.has(payment.jobId), salesEffect: 0, paymentEffect: paise(payment.amount) });
  }
  if (new Set(rows.map(row => row.id)).size !== rows.length) throw Error("Legacy records contain duplicate IDs; totals are unavailable.");
  return { rows, warnings: [...new Set(warnings)], activeOutstandingPaise: activeOutstanding(snapshot) };
}
export function selectReport(report: Report, filter: ReportFilter, pendingRowIds?: ReadonlySet<string>) {
  if ((filter.from && !validReportDay(filter.from)) || (filter.to && !validReportDay(filter.to)) || (filter.from && filter.to && filter.from > filter.to)) throw Error("Choose a valid From / To date range.");
  const period = report.rows.filter(row => (!filter.from || row.day >= filter.from) && (!filter.to || row.day <= filter.to));
  const sales = sum(period.map(row => row.salesEffect)), payments = sum(period.map(row => row.paymentEffect));
  const query = filter.search.trim().toLowerCase();
  const numericQuery = query.replace(/[₹,\s]/g, "");
  const nameWords = (value: string) => value.toLowerCase().split(/[^\p{L}\p{M}\p{N}]+/u).filter(Boolean);
  const queryWords = nameWords(query);
  const numericSearch = /^\d+(?:\.\d+)?$/.test(numericQuery);
  const rows = period.filter(row => (filter.kind === "pending_sales" ? !!pendingRowIds?.has(row.id) : filter.kind === "all" || row.kind === filter.kind || filter.kind === "correction" && row.kind === "reversal") && (!query || queryWords.length > 0 && queryWords.every(word => nameWords(row.customer).some(name => name.startsWith(word))) || numericSearch && String(row.amountPaise / 100).includes(numericQuery)));
  rows.sort((a, b) => {
    const result = filter.sort === "amount" ? a.amountPaise - b.amountPaise : filter.sort === "customer" ? a.customer.localeCompare(b.customer) : a.day.localeCompare(b.day);
    return (result || a.sortAt - b.sortAt || a.id.localeCompare(b.id)) * (filter.descending ? -1 : 1);
  });
  return { rows, sales, payments, periodBalance: sum([sales, -payments]) };
}
export function reportCsv(rows: ReportTransaction[]) {
  const cell = (value: string) => '"' + (!/^-?\d+(?:\.\d+)?$/.test(value) && /^[\s]*[=+\-@\t\r]/.test(value) ? "'" : "") + value.replaceAll('"', '""') + '"';
  return '\uFEFF' + ["Date (UTC),Customer,Type,Amount INR,Sales effect INR,Payment effect INR,History,Description", ...rows.map(row => [row.day, row.customer, row.kind, paiseDecimal(row.amountPaise), row.unclassified ? "" : paiseDecimal(row.salesEffect), row.unclassified ? "" : paiseDecimal(row.paymentEffect), row.historical ? "Historical / unlinked" : "Active work", row.description].map(cell).join(","))].join("\r\n");
}
