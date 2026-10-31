import { formatReportMoney, type ReportTransaction } from "@/lib/reports";

const transactionLabels: Record<string, string> = {
  charge: "Sale", payment: "Payment Received", correction: "Correction", reversal: "Reversal",
  adjustment: "Adjustment", opening_balance: "Opening Balance",
};

export default function ReportsMobileTransactions({ rows, total }: { rows: ReportTransaction[]; total: number }) {
  return <section className="reports-mobile-transactions" aria-label="Transaction History">
    <header className="reports-mobile-heading"><h2>Transaction History</h2><p>{total} matching transactions</p></header>
    <ul>{rows.map(row => {
      const effect = row.salesEffect - row.paymentEffect;
      const effectLabel = row.unclassified ? "Unclassified" : effect > 0 ? `+${formatReportMoney(effect)}` : effect < 0 ? `−${formatReportMoney(-effect)}` : formatReportMoney(0);
      const date = new Intl.DateTimeFormat("en-IN", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" }).format(new Date(`${row.day}T00:00:00Z`));
      return <li key={row.id}>
        <article className="reports-transaction-card" data-kind={row.kind}>
          <header className="reports-card-header"><h3>{row.customer}</h3><strong className="reports-card-amount">{formatReportMoney(row.amountPaise)}</strong></header>
          <p className="reports-card-meta"><time dateTime={row.day} aria-label={`${date} (UTC)`}>{date}</time><span aria-hidden="true"> · </span><span className="reports-card-type">{transactionLabels[row.kind] || row.kind.replaceAll("_", " ")}</span></p>
          <dl className="reports-card-effect"><dt>Balance effect</dt><dd>{effectLabel}</dd></dl>
          <p className="reports-card-description">{row.description}</p>
          <p className="reports-card-history">{row.historical ? "Historical / unlinked work" : "Active work"}</p>
        </article>
      </li>;
    })}</ul>
    {!rows.length && <p className="reports-empty">No transactions in this report. Try a longer period or a custom range, then click Show Report.</p>}
  </section>;
}
