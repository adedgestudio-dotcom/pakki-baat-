import type { Job, Snapshot } from "./data";
import type { LedgerRow, Report, ReportFilter, ReportTransaction } from "./reports";

type LinkedLedgerRow = LedgerRow & { source_payment_id?: string | null };
export type GroupEvent = {
  row: ReportTransaction;
  matches: boolean;
  inPeriod: boolean;
  role: "Sale" | "Receipt" | "Reversal" | "Replacement" | "Unclassified";
};
export type ReceiptChain = { id: string; events: GroupEvent[]; netPaise: number };
export type ReportGroup = {
  id: string;
  jobId?: string;
  job?: Job;
  customer: string;
  label: "Sale" | "Historical / deleted sale" | "Unlinked receipt / event" | "Unclassified event";
  lifetime: { totalPaise: number; receivedPaise: number; bakiPaise: number } | null;
  lifetimeSource: "Current workspace" | "Loaded history" | null;
  period: { salesPaise: number; receivedPaise: number };
  matches: ReportTransaction[];
  events: GroupEvent[];
  sales: GroupEvent[];
  receipts: ReceiptChain[];
  other: GroupEvent[];
  detailRow: ReportTransaction;
};

function sum(values: number[]) {
  return values.reduce((total, value) => {
    const next = total + value;
    if (!Number.isSafeInteger(next)) throw Error("Grouped display exceeds safe currency precision.");
    return next;
  }, 0);
}
function rupeePaise(value: number) {
  const amount = Math.round(value * 100);
  if (!Number.isSafeInteger(amount)) throw Error("Invalid workspace display amount.");
  return amount;
}

/** Display projection only. Never changes report rows, selects totals, or exports CSV.
 * matchingRows is the existing applied flat selection; full history supplies context.
 * Input ledger order is the reader's created_at/id order, preserving correction order.
 */
export function groupReportRows(
  ownerId: string, report: Report, snapshot: Snapshot, matchingRows: ReportTransaction[],
  filter: ReportFilter, ledgerRows?: LinkedLedgerRow[],
): ReportGroup[] {
  const ledger = new Map<string, LinkedLedgerRow>();
  for (const row of ledgerRows || []) {
    if (row.owner_id !== ownerId) throw Error("Grouped report belongs to another account.");
    if (ledger.has(row.id)) throw Error("Duplicate grouped ledger event.");
    ledger.set(row.id, row);
  }
  const jobs = new Map(snapshot.jobs.map(job => [job.id, job]));
  const payments = new Map((snapshot.payments || []).map(payment => [payment.id, payment]));
  const selected = new Set(matchingRows.map(row => row.id));
  const matchOrder = new Map(matchingRows.map((row, index) => [row.id, index]));

  // Alias receipt IDs across source UUIDs, live metadata IDs and legacy IDs.
  // Replacements may have no source_payment_id; reversals refer to the original.
  const parents = new Map<string, string>();
  const root = (id: string): string => {
    const parent = parents.get(id);
    if (!parent) { parents.set(id, id); return id; }
    if (parent === id) return id;
    const result = root(parent);
    parents.set(id, result);
    return result;
  };
  const eventKey = (id: string) => JSON.stringify(["event", id]);
  const aliases = (row: LinkedLedgerRow) => [
    row.source_payment_id, row.metadata?.payment_id, row.metadata?.legacy_payment_id,
  ].filter((value): value is string => typeof value === "string" && value.length > 0).map(value => JSON.stringify(["receipt", value]));
  for (const row of ledger.values()) {
    const original = row.reverses_transaction_id ? ledger.get(row.reverses_transaction_id) : undefined;
    const ids = [...aliases(row), ...(original ? aliases(original) : []), eventKey(row.id),
      ...(original ? [eventKey(original.id)] : [])];
    for (const id of ids.slice(1)) parents.set(root(id), root(ids[0]));
  }

  const groups = new Map<string, ReportGroup>();
  const receiptBuckets = new Map<string, Map<string, GroupEvent[]>>();
  for (const row of report.rows) {
    const entry = ledger.get(row.id);
    const original = entry?.reverses_transaction_id ? ledger.get(entry.reverses_transaction_id) : undefined;
    const basis = original?.transaction_kind || entry?.transaction_kind || row.kind;
    const payment = !ledgerRows && row.id.startsWith("payment:") ? payments.get(row.id.slice(8)) : undefined;
    const jobId = ledgerRows ? entry?.job_id || original?.job_id || undefined
      : row.id.startsWith("job:") ? row.id.slice(4) : payment?.jobId;
    const receiptId = ledgerRows ? root(eventKey(row.id)) : row.id;
    const bucket = row.unclassified ? ["unclassified", row.id]
      : jobId ? ["job", jobId]
      : ["unlinked", basis === "payment" ? receiptId : original?.id || row.id];
    const id = JSON.stringify([ownerId, ...bucket]);
    let group = groups.get(id);
    if (!group) {
      const job = jobId && !row.unclassified ? jobs.get(jobId) : undefined;
      group = {
        id, jobId, job, customer: job?.customer || row.customer,
        label: row.unclassified ? "Unclassified event" : jobId ? job ? "Sale" : "Historical / deleted sale" : "Unlinked receipt / event",
        lifetime: null, lifetimeSource: null, period: { salesPaise: 0, receivedPaise: 0 },
        matches: [], events: [], sales: [], receipts: [], other: [], detailRow: row,
      };
      groups.set(id, group);
    }
    const event: GroupEvent = {
      row, matches: selected.has(row.id),
      inPeriod: (!filter.from || row.day >= filter.from) && (!filter.to || row.day <= filter.to),
      role: row.unclassified ? "Unclassified" : row.kind === "reversal" ? "Reversal"
        : row.kind === "correction" ? "Replacement" : basis === "payment" ? "Receipt" : "Sale",
    };
    group.events.push(event);
    if (event.matches) group.matches.push(row);
    if (basis === "payment" && !row.unclassified) {
      let receipts = receiptBuckets.get(id);
      if (!receipts) { receipts = new Map(); receiptBuckets.set(id, receipts); }
      const chain = receipts.get(receiptId) || [];
      chain.push(event);
      receipts.set(receiptId, chain);
    } else if (basis === "charge" && !row.unclassified) {
      group.sales.push(event);
      if (row.kind !== "reversal") group.detailRow = row;
    } else group.other.push(event);
  }
  for (const group of groups.values()) {
    group.receipts = [...(receiptBuckets.get(group.id) || new Map<string, GroupEvent[]>())].map(([id, events]) => ({
      id, events, netPaise: sum(events.map(event => event.row.paymentEffect)),
    }));
    const period = group.events.filter(event => event.inPeriod);
    group.period = {
      salesPaise: sum(period.map(event => event.row.salesEffect)),
      receivedPaise: sum(period.map(event => event.row.paymentEffect)),
    };
    if (group.job || group.label === "Historical / deleted sale") {
      const totalPaise = group.job ? rupeePaise(group.job.total) : sum(group.events.map(event => event.row.salesEffect));
      const receivedPaise = group.job ? rupeePaise(group.job.paid) : sum(group.events.map(event => event.row.paymentEffect));
      group.lifetime = { totalPaise, receivedPaise, bakiPaise: sum([totalPaise, -receivedPaise]) };
      group.lifetimeSource = group.job ? "Current workspace" : "Loaded history";
    }
  }
  // Visibility and group ordering follow the first matching flat row, never names.
  return [...groups.values()].filter(group => group.matches.length > 0).sort((a, b) => (
    a.matches.reduce((min, row) => Math.min(min, matchOrder.get(row.id)!), Infinity) - b.matches.reduce((min, row) => Math.min(min, matchOrder.get(row.id)!), Infinity)
  ));
}
