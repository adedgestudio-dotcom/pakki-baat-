"use client";

import { useEffect, useReducer, useState } from "react";
import { loadReportLedger } from "@/lib/cloud";
import type { Snapshot } from "@/lib/data";
import { formatReportMoney, ledgerReport, legacyReport, reportCsv, selectReport, type LedgerRow, type ReportFilter } from "@/lib/reports";
import { advancedReportTypes, createReportUiState, orderReportDates, reportFiltersPending, reportTypeLabels, reportUiReducer, type ReportPeriod } from "@/lib/reports-ui";
import "./reports.css";
import ReportsPrintDocument from "./reports-print";
import ReportsMobileTransactions from "./reports-mobile";

type Props = { ownerId: string | null; ledgerEnabled: boolean; snapshot: Snapshot; cloudSaveVersion: number; pending: boolean };
type History = { ownerId: string; key: string; state: "loaded"; rows: LedgerRow[] } | { ownerId: string; key: string; state: "error" } | null;

export default function Reports({ ownerId, ledgerEnabled, snapshot, cloudSaveVersion, pending }: Props) {
  const [history, setHistory] = useState<History>(null);
  const [ui, dispatch] = useReducer(reportUiReducer, undefined, () => createReportUiState(new Date()));
  const filter = ui.applied.filter;
  const [reload, setReload] = useState(0);
  const requestKey = `${ownerId}:${ledgerEnabled}:${cloudSaveVersion}:${reload}`;
  useEffect(() => {
    if (!ownerId || !ledgerEnabled) return;
    let disposed = false;
    // Clear previous results before any new read; never display another owner's data.
    void loadReportLedger(ownerId).then(rows => {
      if (!disposed) setHistory({ ownerId, key: requestKey, state: "loaded", rows });
    }).catch(() => {
      if (!disposed) setHistory({ ownerId, key: requestKey, state: "error" });
    });
    return () => { disposed = true; };
  }, [ownerId, ledgerEnabled, requestKey]);
  const current = history?.ownerId === ownerId && history.key === requestKey ? history : null;
  function refresh() { setHistory(null); setReload(value => value + 1); }
  function update<K extends keyof ReportFilter>(key: K, value: ReportFilter[K]) { dispatch({ type: "edit", filter: { [key]: value } }); }
  if (!ownerId) return <section className="panel reports-page"><h1>Reports</h1><p>Sign in and load your workspace to view Reports.</p></section>;
  if (ledgerEnabled && !current) return <section className="panel reports-page" aria-busy="true"><h1>Reports</h1><p role="status">Loading your ledger history…</p></section>;
  if (ledgerEnabled && current?.state === "error") return <section className="panel reports-page"><h1>Reports</h1><p role="alert">Ledger history could not be loaded. No partial or legacy totals are shown.</p><button className="outline" onClick={refresh}>Try again</button></section>;
  let report: ReturnType<typeof legacyReport>, view: ReturnType<typeof selectReport>;
  try {
    report = ledgerEnabled && current?.state === "loaded" ? ledgerReport(current.rows, ownerId, snapshot) : legacyReport(snapshot);
    view = selectReport(report, filter);
  } catch (cause) {
    return <section className="panel reports-page"><h1>Reports</h1><p role="alert">{cause instanceof Error ? cause.message : "Report unavailable."}</p><button className="outline" onClick={refresh}>Reload history</button></section>;
  }
  const timestamps = new Map<string, number>();
  if (ledgerEnabled && current?.state === "loaded") {
    current.rows.forEach(row => timestamps.set(row.id, Date.parse(row.occurred_at)));
  } else {
    snapshot.jobs.forEach(job => timestamps.set(`job:${job.id}`, Date.parse(job.createdAt || job.date)));
    snapshot.payments?.forEach(payment => timestamps.set(`payment:${payment.id}`, Date.parse(payment.createdAt)));
  }
  const matchingRows = orderReportDates(view.rows, filter, timestamps);
  const draft = ui.draft.filter;
  const unapplied = reportFiltersPending(ui);
  const incomplete = report.warnings.some(warning => warning.includes("incomplete") || warning.includes("do not reconcile") || warning.includes("omitted"));
  function download() {
    const blob = new Blob([reportCsv(matchingRows)], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url; anchor.download = "pakki-baat-transactions.csv"; anchor.click();
    URL.revokeObjectURL(url);
  }
  return <section className="reports-page" aria-label="Financial reports">
    <header className="reports-heading"><div><h1>Reports</h1><p>See your sales, receipts and balance.</p></div><div className="reports-actions"><button className="outline" onClick={refresh}>Refresh history</button><button className="outline" onClick={download}>Download CSV</button><button className="outline" onClick={() => window.print()}>Print</button></div></header>
    {pending && <p role="status" className="reports-notice">Workspace changes are awaiting cloud acknowledgement. Ledger figures show the last loaded server history; active outstanding includes local changes.</p>}
    {report.warnings.map(warning => <p className="reports-notice" key={warning}>{warning}</p>)}
    <form className="reports-filter-panel" onSubmit={event => { event.preventDefault(); dispatch({ type: "apply", now: new Date() }); }}>
      <div className="reports-filters">
        <label>Period<select value={ui.draft.period} onChange={event => dispatch({ type: "period", period: event.target.value as ReportPeriod, now: new Date() })}><option value="today">Today</option><option value="seven">Last 7 days</option><option value="thirty">Last 30 days</option><option value="custom">Custom range</option></select></label>
        {ui.draft.period === "custom" && <><label>From<input type="date" value={draft.from} onChange={event => update("from", event.target.value)} /></label><label>To<input type="date" value={draft.to} onChange={event => update("to", event.target.value)} /></label></>}
        <label>Customer or amount<input type="search" placeholder="Name or ₹ amount" value={draft.search} onChange={event => update("search", event.target.value)} /></label>
        <label>Transactions<select value={advancedReportTypes.includes(draft.kind) ? "advanced" : draft.kind} onChange={event => update("kind", event.target.value)}>{["all", "charge", "payment", "correction"].map(kind => <option key={kind} value={kind}>{reportTypeLabels[kind]}</option>)}{advancedReportTypes.includes(draft.kind) && <option value="advanced" disabled>{reportTypeLabels[draft.kind]} (Advanced)</option>}</select></label>
      </div>
      {ui.draft.period === "custom" && <p className="reports-semantics">Leave either date blank for an open range, or both blank for all dates.</p>}
      <details className="reports-advanced"><summary>Advanced Filters</summary><div className="reports-filters">
        <label>Audit transaction type<select value={advancedReportTypes.includes(draft.kind) ? draft.kind : ""} onChange={event => { if (event.target.value) update("kind", event.target.value); }}><option value="">Choose an audit type</option>{advancedReportTypes.map(kind => <option key={kind} value={kind}>{reportTypeLabels[kind]}</option>)}</select></label>
        <label>Sort by<select value={draft.sort} onChange={event => update("sort", event.target.value as ReportFilter["sort"])}><option value="date">Date</option><option value="amount">Amount</option><option value="customer">Customer</option></select></label>
        <label>Order<select value={draft.descending ? "desc" : "asc"} onChange={event => update("descending", event.target.value === "desc")}><option value="desc">Newest / highest first</option><option value="asc">Oldest / lowest first</option></select></label>
      </div></details>
      <div className="reports-apply"><button type="submit" className="primary">Show Report</button><span role="status" aria-live="polite">{unapplied ? "Filters changed — click Show Report to apply." : "Showing applied filters."}</span></div>
      {ui.error && <p role="alert" className="reports-filter-error">{ui.error}</p>}
    </form>
    <div className="reports-overview">{[["Total Sales", view.sales], ["Payments Received", view.payments], ["Period Balance", view.periodBalance], ["Overall Outstanding", report.activeOutstandingPaise]].map(([label, value], index) => <div className="panel" key={String(label)}><span>{label}</span><strong>{incomplete && index < 3 ? "Needs reconciliation" : formatReportMoney(Number(value))}</strong></div>)}</div>
    <p className="reports-semantics">Sales and receipts use the applied date range. Period Balance is sales less receipts; Overall Outstanding covers all active work.</p>
    <details className="reports-accounting"><summary>How dates and balances work</summary><p className="reports-semantics">Presets use your local calendar to choose inclusive dates. Ledger entries are matched by their UTC transaction date, not converted to local timestamps. Legacy payments use their recorded date; jobs use creation date or, when missing, work date. Search and transaction type filter the table, CSV and print, while overview totals use the date range. Reversals undo earlier entries and are not extra receipts or cash refunds. Historical / unlinked records may include deleted work, which is excluded from Overall Outstanding.</p></details>
    <div className="reports-print-context">Applied period: {filter.from || "All dates"} to {filter.to || "All dates"} · Search: {filter.search || "None"} · Transactions: {reportTypeLabels[filter.kind] || filter.kind}</div>
    <div className="reports-table-wrap">
      <table>
        <caption>Transaction History — {matchingRows.length} matching transactions</caption>
        <thead><tr><th scope="col">Date (UTC)</th><th scope="col">Customer</th><th scope="col">Type</th><th scope="col">Amount</th><th scope="col">Balance effect</th><th scope="col">Details</th></tr></thead>
        <tbody>{matchingRows.map((row, index) => <tr key={row.id} className={index >= ui.visibleCount ? "reports-print-only-row" : undefined}>
          <td>{row.day}</td>
          <td>{row.customer}<small>{row.historical ? "Historical / unlinked" : "Active work"}</small></td>
          <td>{reportTypeLabels[row.kind] || row.kind.replaceAll("_", " ")}</td>
          <td className="reports-amount">{formatReportMoney(row.amountPaise)}</td>
          <td className="reports-amount">{row.unclassified ? "Unclassified" : formatReportMoney(row.salesEffect - row.paymentEffect)}</td>
          <td>{row.description}</td>
        </tr>)}</tbody>
      </table>
      {!matchingRows.length && <p className="reports-empty">No transactions in this report. Try a longer period or a custom range, then click Show Report.</p>}
    </div>
    <ReportsMobileTransactions rows={matchingRows.slice(0, ui.visibleCount)} total={matchingRows.length} />
    <div className="reports-pagination"><p>Showing {Math.min(ui.visibleCount, matchingRows.length)} of {matchingRows.length} matching transactions</p>{ui.visibleCount < matchingRows.length && <button type="button" className="outline" onClick={() => dispatch({ type: "more" })}>Load 20 More</button>}</div>
    <ReportsPrintDocument filter={filter} rows={matchingRows} summary={{ sales: view.sales, payments: view.payments, periodBalance: view.periodBalance, outstanding: report.activeOutstandingPaise }} incomplete={incomplete} warnings={report.warnings} pending={pending} ledgerEnabled={ledgerEnabled} />
  </section>;
}
