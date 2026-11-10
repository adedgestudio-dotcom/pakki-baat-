import { formatReportMoney, type ReportTransaction } from "@/lib/reports";
import type { ReportGroup } from "@/lib/reports-groups";

const typeLabel: Record<string, string> = { charge: "Sale", payment: "Payment received", correction: "Correction", reversal: "Correction", adjustment: "Other", opening_balance: "Other" };

export default function ReportsMobileTransactions({ rows, groups, total, onSelect }: { rows: ReportTransaction[]; groups: ReportGroup[]; total: number; onSelect: (row: ReportTransaction) => void }) {
  const byRow = new Map(groups.flatMap(group => group.matches.map(row => [row.id, group] as const)));
  return <section className="reports-mobile-transactions" aria-label="Transactions">
    <h2>Transactions ({total})</h2>
    <ul>{rows.map(row => {
      const group = byRow.get(row.id);
      return <li key={row.id}><button type="button" className="reports-transaction-card" onClick={() => onSelect(row)}>
        <span className="reports-card-header"><strong>{row.customer}</strong><strong className="reports-card-amount">{formatReportMoney(row.amountPaise)}</strong></span>
        <span className="reports-card-meta"><time dateTime={row.day}>{row.day}</time><span className="reports-card-type">{typeLabel[row.kind] || row.kind.replaceAll("_", " ")}</span></span>
        <span className="reports-card-pending">Pending: {group?.lifetime ? formatReportMoney(group.lifetime.bakiPaise) : "No linked sale"}</span>
      </button></li>;
    })}</ul>
    {!rows.length && <p className="reports-empty">No transactions match these filters.</p>}
  </section>;
}
