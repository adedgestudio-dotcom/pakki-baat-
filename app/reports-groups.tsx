import { formatReportMoney, type ReportTransaction } from "@/lib/reports";
import type { GroupEvent, ReportGroup } from "@/lib/reports-groups";

function EventList({ events, onSelect }: { events: GroupEvent[]; onSelect: (row: ReportTransaction) => void }) {
  return <ol className="reports-group-events">{events.map(event => <li key={event.row.id}>
    <div><strong>{event.role}</strong> <time dateTime={event.row.day}>{event.row.day} (UTC)</time> <strong>{formatReportMoney(event.row.amountPaise)}</strong></div>
    <small>{event.matches ? "Matches current filters" : "Context only - outside current filters"}</small>
    <p>{event.row.description}</p>
    <button type="button" className="reports-detail-link" onClick={() => onSelect(event.row)}>View transaction</button>
  </li>)}</ol>;
}

export default function ReportsGroups({ groups, total, onSelect }: {
  groups: ReportGroup[]; total: number; onSelect: (row: ReportTransaction) => void;
}) {
  return <section className="reports-grouped-history" aria-label="Sales and receipt history">
    <header><h2>Sales and receipt history</h2><p>{total} sale / fallback groups match the current filters.</p></header>
    {groups.map(group => {
      const firstSaleDate = group.sales.filter(event => event.role !== "Reversal").map(event => event.row.day).sort()[0];
      return <details key={group.id} className="reports-sale-group">
      <summary>
        <span className="reports-group-name"><strong>{group.customer}</strong><span>{group.job?.work || group.detailRow.description}</span><small>{group.label}{firstSaleDate ? <> - First sale <time dateTime={firstSaleDate}>{firstSaleDate}</time> (UTC)</> : " - First sale date unavailable"}</small></span>
        {group.lifetime ? <span className="reports-group-values" aria-label="Lifetime figures">
          <span><small>Lifetime total</small><strong>{formatReportMoney(group.lifetime.totalPaise)}</strong></span>
          <span><small>Received so far - lifetime</small><strong>{formatReportMoney(group.lifetime.receivedPaise)}</strong></span>
          <span><small>Lifetime baki</small><strong>{formatReportMoney(group.lifetime.bakiPaise)}</strong></span>
        </span> : <span>Expand to view events - no sale total inferred</span>}
        <span className="reports-group-toggle"><svg className="reports-group-chevron" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true"><path d="m6 9 6 6 6-6" /></svg><span className="reports-open-hint">Tap to open</span><span className="reports-close-hint">Tap to close</span></span>
      </summary>
      <div className="reports-group-content">
        <p>{group.lifetimeSource ? group.lifetimeSource + " lifetime figures. " : ""}{group.matches.length} matching transaction(s). Other events are shown as context, including events outside the selected period.</p>
        {group.label === "Historical / deleted sale" && <p className="reports-notice">Historical / deleted sale: figures reflect loaded history and are excluded from Overall Outstanding.</p>}
        <dl className="reports-group-period"><div><dt>Sales activity - selected period</dt><dd>{formatReportMoney(group.period.salesPaise)}</dd></div><div><dt>Receipts activity - selected period</dt><dd>{formatReportMoney(group.period.receivedPaise)}</dd></div></dl>
        <button type="button" className="reports-detail-link" onClick={() => onSelect(group.detailRow)}>View read-only {group.jobId ? "sale" : "transaction"} details</button>
        {group.sales.length > 0 && <section aria-label="Sale history"><h3>Sale history</h3><EventList events={group.sales} onSelect={onSelect} /></section>}
        {group.receipts.length > 0 && <section aria-label="Receipts and corrections"><h3>Receipts and corrections</h3>{group.receipts.map((receipt, index) => <section className="reports-receipt-chain" key={receipt.id}>
          <h4>Receipt {index + 1} - net received over lifetime {formatReportMoney(receipt.netPaise)}</h4>
          {receipt.events[0]?.role === "Replacement" && <p>Earlier receipt identity is unavailable; no match was guessed.</p>}
          <EventList events={receipt.events} onSelect={onSelect} />
        </section>)}</section>}
        {group.jobId && !group.receipts.length && <p>No receipt records are linked to this sale.</p>}
        {group.other.length > 0 && <section aria-label="Unclassified or unlinked history"><h3>Other events</h3><EventList events={group.other} onSelect={onSelect} /></section>}
      </div>
    </details>; })}
    {!groups.length && <p className="reports-empty">No transactions in this report. Try a longer period or a custom range, then click Show Report.</p>}
  </section>;
}
