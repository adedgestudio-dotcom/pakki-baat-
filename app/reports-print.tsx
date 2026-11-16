import { formatReportMoney, type ReportFilter, type ReportEntry } from "@/lib/reports";
import { reportTypeLabels } from "@/lib/reports-ui";

type Props = {
  filter: ReportFilter;
  rows: ReportEntry[];
  summary: { sales: number; payments: number; periodBalance: number; outstanding: number };
  incomplete: boolean;
  warnings: string[];
  pending: boolean;
  ledgerEnabled: boolean;
};

// Presentation only. Receives exactly the same applied selection and values as the screen/CSV.
export default function ReportsPrintDocument({ filter, rows, summary, incomplete, warnings, pending }: Props) {
  return <section className="reports-print-document" data-reports-print-root="true" aria-label="Printable financial report">
    <header className="reports-print-heading">
      <p className="reports-print-brand">Pakki Baat</p>
      <h1>Reports</h1>
    </header>
    <dl className="reports-print-filters">
      <div><dt>From</dt><dd>{filter.from || "All dates"}</dd></div>
      <div><dt>To</dt><dd>{filter.to || "All dates"}</dd></div>
      <div><dt>Customer or amount</dt><dd>{filter.search || "All"}</dd></div>
      <div><dt>Entries</dt><dd>{reportTypeLabels[filter.kind] || filter.kind}</dd></div>
      <div><dt>Sort</dt><dd>{filter.sort} · {filter.descending ? "descending" : "ascending"}</dd></div>
    </dl>
    <div className="reports-print-summary">
      {[["Total Sales", summary.sales], ["Payments Received", summary.payments], ["Overall Outstanding", summary.outstanding]].map(([label, value], index) =>
        <div key={String(label)}><span>{label}</span><strong>{incomplete && index < 2 ? "Needs reconciliation" : formatReportMoney(Number(value))}</strong></div>
      )}
    </div>
    {pending && <p className="reports-print-warning">Workspace changes are awaiting cloud acknowledgement. Ledger figures reflect loaded server history; Overall Outstanding includes local changes.</p>}
    {warnings.map(warning => <p className="reports-print-warning" key={warning}>{warning}</p>)}
    <p className="reports-print-explanation">Dates are inclusive. Entries use their recorded date. Summary totals use the existing transaction dates; search and entry status filter the list. Overall Outstanding covers active work across all dates.</p>
    <table>
      <caption>Entries ({rows.length})</caption>
      <colgroup><col className="print-date" /><col className="print-customer" /><col className="print-details" /><col className="print-money" /><col className="print-money" /><col className="print-money" /></colgroup>
      <thead><tr><th scope="col">Date</th><th scope="col">Customer</th><th scope="col">Work</th><th scope="col">Total</th><th scope="col">Received</th><th scope="col">Pending</th></tr></thead>
      <tbody>{rows.map(row => <tr key={row.id}>
        <td>{row.day}</td>
        <td>{row.customer}</td><td>{row.work}</td><td>{formatReportMoney(row.totalPaise)}</td><td>{formatReportMoney(row.receivedPaise)}</td><td>{formatReportMoney(row.pendingPaise)}</td>
      </tr>)}</tbody>
    </table>
    {!rows.length && <p>No entries match the applied filters.</p>}
  </section>;
}
