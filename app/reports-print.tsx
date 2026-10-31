import { formatReportMoney, type ReportFilter, type ReportTransaction } from "@/lib/reports";
import { reportTypeLabels } from "@/lib/reports-ui";

type Props = {
  filter: ReportFilter;
  rows: ReportTransaction[];
  summary: { sales: number; payments: number; periodBalance: number; outstanding: number };
  incomplete: boolean;
  warnings: string[];
  pending: boolean;
  ledgerEnabled: boolean;
};

// Presentation only. Receives exactly the same applied selection and values as the screen/CSV.
export default function ReportsPrintDocument({ filter, rows, summary, incomplete, warnings, pending, ledgerEnabled }: Props) {
  return <section className="reports-print-document" data-reports-print-root="true" aria-label="Printable financial report">
    <header className="reports-print-heading">
      <p className="reports-print-brand">Pakki Baat</p>
      <h1>Reports</h1>
    </header>
    <dl className="reports-print-filters">
      <div><dt>From</dt><dd>{filter.from || "All dates"}</dd></div>
      <div><dt>To</dt><dd>{filter.to || "All dates"}</dd></div>
      <div><dt>Customer or amount</dt><dd>{filter.search || "All"}</dd></div>
      <div><dt>Transactions</dt><dd>{reportTypeLabels[filter.kind] || filter.kind}</dd></div>
      <div><dt>Sort</dt><dd>{filter.sort} · {filter.descending ? "descending" : "ascending"}</dd></div>
    </dl>
    <div className="reports-print-summary">
      {[["Total Sales", summary.sales], ["Payments Received", summary.payments], ["Period Balance", summary.periodBalance], ["Overall Outstanding", summary.outstanding]].map(([label, value], index) =>
        <div key={String(label)}><span>{label}</span><strong>{incomplete && index < 3 ? "Needs reconciliation" : formatReportMoney(Number(value))}</strong></div>
      )}
    </div>
    {pending && <p className="reports-print-warning">Workspace changes are awaiting cloud acknowledgement. Ledger figures reflect loaded server history; Overall Outstanding includes local changes.</p>}
    {warnings.map(warning => <p className="reports-print-warning" key={warning}>{warning}</p>)}
    <p className="reports-print-explanation">Dates are inclusive. {ledgerEnabled ? "Ledger entries use UTC transaction dates." : "Legacy payments use their recorded date; jobs use creation date or work date when unavailable."} Summary totals use the date range; search and transaction type filter the history below. Period Balance is sales less receipts, not an opening-balance statement. Overall Outstanding covers active work across all dates. Reversals undo earlier transactions and are not extra receipts or cash refunds.</p>
    <table>
      <caption>Transaction History — {rows.length} matching transactions</caption>
      <colgroup><col className="print-date" /><col className="print-customer" /><col className="print-type" /><col className="print-money" /><col className="print-money" /><col className="print-details" /></colgroup>
      <thead><tr><th scope="col">Date (UTC)</th><th scope="col">Customer</th><th scope="col">Type</th><th scope="col">Amount</th><th scope="col">Balance effect</th><th scope="col">Details</th></tr></thead>
      <tbody>{rows.map(row => <tr key={row.id}>
        <td>{row.day}</td>
        <td>{row.customer}<small>{row.historical ? "Historical / unlinked" : "Active work"}</small></td>
        <td>{reportTypeLabels[row.kind] || row.kind.replaceAll("_", " ")}</td>
        <td>{formatReportMoney(row.amountPaise)}</td>
        <td>{row.unclassified ? "Unclassified" : formatReportMoney(row.salesEffect - row.paymentEffect)}</td>
        <td>{row.description}</td>
      </tr>)}</tbody>
    </table>
    {!rows.length && <p>No transactions match the applied filters.</p>}
  </section>;
}
