"use client";

import { useReducer, useState } from "react";
import type { Snapshot } from "@/lib/data";
import { formatReportMoney, legacyReport, reportCsv, selectReport, type ReportTransaction, type ReportFilter } from "@/lib/reports";
import { advancedReportTypes, createReportUiState, reportFiltersPending, reportTypeLabels, reportUiReducer, type ReportPeriod } from "@/lib/reports-ui";
import "./reports.css";
import ReportsPrintDocument from "./reports-print";
import ReportsGroups from "./reports-groups";
import ReportsMobileTransactions from "./reports-mobile";
import { groupReportRows, pendingReportJobIds, type ReportGroup } from "@/lib/reports-groups";
import ReportsTransactionDetail from "./reports-detail";
import SelectMenu from "./select-menu";

type Props = { ownerId: string | null; ledgerEnabled: boolean; snapshot: Snapshot; cloudSaveVersion: number; pending: boolean };

export default function Reports({ ownerId, ledgerEnabled, snapshot, cloudSaveVersion, pending }: Props) {
  const [ui, dispatch] = useReducer(reportUiReducer, undefined, () => createReportUiState(new Date()));
  const filter = ui.applied.filter;
  const [reload, setReload] = useState(0);
  const [selected, setSelected] = useState<{ownerId:string; key:string; row:ReportTransaction}|null>(null);
  const requestKey = `${ownerId}:${ledgerEnabled}:${cloudSaveVersion}:${reload}`;
  function refresh() { setReload(value => value + 1); }
  function update<K extends keyof ReportFilter>(key: K, value: ReportFilter[K]) { dispatch({ type: "edit", filter: { [key]: value } }); }
  if (!ownerId) return <section className="panel reports-page reports-state"><h1>Reports</h1><p>Sign in and load your workspace to view Reports.</p></section>;
  let report: ReturnType<typeof legacyReport>, view: ReturnType<typeof selectReport>, groups: ReportGroup[];
  try {
    report = legacyReport(snapshot);
    if (filter.kind === "pending_sales") {
      const allFilter = { ...filter, kind: "all" };
      const candidates = groupReportRows(ownerId, report, snapshot, selectReport(report, allFilter).rows, allFilter);
      const pendingJobs = pendingReportJobIds(candidates);
      const pendingRows = new Set(candidates.filter(group => group.jobId && pendingJobs.has(group.jobId)).flatMap(group => group.matches.map(row => row.id)));
      view = selectReport(report, filter, pendingRows);
    } else view = selectReport(report, filter);
    groups = groupReportRows(ownerId, report, snapshot, view.rows, filter);
  } catch (cause) {
    return <section className="panel reports-page reports-state"><h1>Reports</h1><p role="alert">{cause instanceof Error ? cause.message : "Report unavailable."}</p><button className="outline" onClick={refresh}>Reload history</button></section>;
  }
  const matchingRows = view.rows;
  const detail = selected?.ownerId === ownerId && selected.key === requestKey ? matchingRows.find(row => row.id === selected.row.id) ?? null : null;
  const detailGroup = detail ? groups.find(group => group.matches.some(row => row.id === detail.id)) : undefined;
  const openDetail = (row: ReportTransaction) => setSelected({ ownerId, key: requestKey, row });
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
    <header className="reports-heading"><h1>Reports</h1><div className="reports-actions"><button className="outline" onClick={refresh}>Refresh history</button><button className="outline" onClick={download}>Download CSV</button><button className="outline" onClick={() => window.print()}>Print</button></div></header>
    <div className="reports-overview">{[["Total sales", view.sales], ["Received", view.payments], ["Pending", report.activeOutstandingPaise]].map(([label, value], index) => <div className="panel" key={String(label)}><span>{label}</span><strong>{incomplete && index < 2 ? "Needs reconciliation" : formatReportMoney(Number(value))}</strong></div>)}</div>
    <form className="reports-filter-panel" onSubmit={event => { event.preventDefault(); dispatch({ type: "apply", now: new Date() }); }}>
      <div className="reports-filters">
        <label>Period<SelectMenu aria-label="Period" value={ui.draft.period} onChange={value => dispatch({ type: "period", period: value as ReportPeriod, now: new Date() })} options={[{value:"today",label:"Today"},{value:"seven",label:"Last 7 days"},{value:"thirty",label:"Last 30 days"},{value:"custom",label:"Custom range"}]} /></label>
        {ui.draft.period === "custom" && <><label>From<input type="date" value={draft.from} onChange={event => update("from", event.target.value)} /></label><label>To<input type="date" value={draft.to} onChange={event => update("to", event.target.value)} /></label></>}
        <label>Customer or amount<input type="search" placeholder="Name or ₹ amount" value={draft.search} onChange={event => update("search", event.target.value)} /></label>
        <label>Transactions<SelectMenu aria-label="Transactions" value={advancedReportTypes.includes(draft.kind) ? "advanced" : draft.kind} onChange={value => update("kind", value)} options={[...["all", "charge", "payment", "correction", "pending_sales"].map(kind => ({value:kind,label:reportTypeLabels[kind]})), ...(advancedReportTypes.includes(draft.kind) ? [{value:"advanced",label:`${reportTypeLabels[draft.kind]} (Advanced)`,disabled:true}] : [])]} /></label>
      </div>
      <details className="reports-advanced"><summary>Advanced Filters</summary><div className="reports-filters">
        <label>Audit transaction type<SelectMenu aria-label="Audit transaction type" value={advancedReportTypes.includes(draft.kind) ? draft.kind : ""} onChange={value => { if (value) update("kind", value); }} options={[{value:"",label:"Choose an audit type"}, ...advancedReportTypes.map(kind => ({value:kind,label:reportTypeLabels[kind]}))]} /></label>
        <label>Sort by<SelectMenu aria-label="Sort by" value={draft.sort} onChange={value => update("sort", value as ReportFilter["sort"])} options={[{value:"date",label:"Date"},{value:"amount",label:"Amount"},{value:"customer",label:"Customer"}]} /></label>
        <label>Order<SelectMenu aria-label="Order" value={draft.descending ? "desc" : "asc"} onChange={value => update("descending", value === "desc")} options={[{value:"desc",label:"Newest / highest first"},{value:"asc",label:"Oldest / lowest first"}]} /></label>
      </div></details>
      <div className="reports-apply"><button type="submit" className="primary">Show Report</button>{unapplied && <span role="status" aria-live="polite">Filters changed — click Show Report to apply.</span>}</div>
      {ui.error && <p role="alert" className="reports-filter-error">{ui.error}</p>}
    </form>
    <ReportsMobileTransactions rows={matchingRows.slice(0, ui.visibleCount)} groups={groups} total={matchingRows.length} onSelect={openDetail} />
    <ReportsGroups rows={matchingRows.slice(0, ui.visibleCount)} groups={groups} total={matchingRows.length} onSelect={openDetail} />
    <div className="reports-pagination"><p>Showing {Math.min(ui.visibleCount, matchingRows.length)} of {matchingRows.length} transactions</p>{ui.visibleCount < matchingRows.length && <button type="button" className="outline" onClick={() => dispatch({ type: "more" })}>Load 20 More</button>}</div>
    <details className="reports-accounting"><summary>How to read this</summary>
      <p className="reports-semantics">Total sales and Received use the selected dates. Pending covers all active sales. Search and transaction type filter the list, CSV and print, while the three cards keep their existing totals.</p>
      <p className="reports-semantics">Leave either custom date blank for an open range. Presets use your local calendar; transactions use UTC dates. Unlinked payments may appear in the list but do not add to Pending.</p>
      {pending && <p role="status" className="reports-notice">Workspace changes are awaiting cloud acknowledgement.</p>}
      {report.warnings.map(warning => <p className="reports-notice" key={warning}>{warning}</p>)}
      <div className="reports-print-context">Applied period: {filter.from || "All dates"} to {filter.to || "All dates"} · Search: {filter.search || "None"} · Transactions: {reportTypeLabels[filter.kind] || filter.kind}</div>
    </details>
    <ReportsPrintDocument filter={filter} rows={matchingRows} summary={{ sales: view.sales, payments: view.payments, periodBalance: view.periodBalance, outstanding: report.activeOutstandingPaise }} incomplete={incomplete} warnings={report.warnings} pending={false} ledgerEnabled={false} />
    {detail && <ReportsTransactionDetail row={detail} group={detailGroup} onClose={() => setSelected(null)} />}
  </section>;
}
