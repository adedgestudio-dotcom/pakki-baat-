"use client";

import { useEffect, useReducer, useState } from "react";
import type { Snapshot } from "@/lib/data";
import { formatReportMoney, legacyReport, reportEntriesCsv, selectReport, selectReportEntries, type ReportEntry, type ReportFilter } from "@/lib/reports";
import { createReportUiState, reportTypeLabels, reportUiReducer, type ReportPeriod } from "@/lib/reports-ui";
import "./reports.css";
import ReportsPrintDocument from "./reports-print";
import ReportsGroups from "./reports-groups";
import ReportsMobileTransactions from "./reports-mobile";
import ReportsTransactionDetail from "./reports-detail";
import SelectMenu from "./select-menu";

type Props = { ownerId: string | null; ledgerEnabled: boolean; snapshot: Snapshot; cloudSaveVersion: number; pending: boolean };

export default function Reports({ ownerId, ledgerEnabled, snapshot, cloudSaveVersion, pending }: Props) {
  const [ui, dispatch] = useReducer(reportUiReducer, undefined, () => createReportUiState(new Date()));
  const [search, setSearch] = useState("");
  useEffect(() => {
    const timer = window.setTimeout(() => { dispatch({ type: "edit", filter: { search } }); dispatch({ type: "apply", now: new Date() }); }, 300);
    return () => window.clearTimeout(timer);
  }, [search]);
  const filter = ui.applied.filter;
  const [reload, setReload] = useState(0);
  const [selected, setSelected] = useState<{ownerId:string; key:string; row:ReportEntry}|null>(null);
  const requestKey = `${ownerId}:${ledgerEnabled}:${cloudSaveVersion}:${reload}`;
  function refresh() { setReload(value => value + 1); }
  function update<K extends keyof ReportFilter>(key: K, value: ReportFilter[K]) { dispatch({ type: "edit", filter: { [key]: value } }); dispatch({ type: "apply", now: new Date() }); }
  if (!ownerId) return <section className="panel reports-page reports-state"><h1>Reports</h1><p>Sign in and load your workspace to view Reports.</p></section>;
  let report: ReturnType<typeof legacyReport>, view: ReturnType<typeof selectReport>, matchingRows: ReportEntry[];
  try {
    report = legacyReport(snapshot);
    view = selectReport(report, { ...filter, kind: "all", search: "" });
    matchingRows = selectReportEntries(snapshot, filter);
  } catch (cause) {
    return <section className="panel reports-page reports-state"><h1>Reports</h1><p role="alert">{cause instanceof Error ? cause.message : "Report unavailable."}</p><button className="outline" onClick={refresh}>Reload history</button></section>;
  }
  const detail = selected?.ownerId === ownerId && selected.key === requestKey ? matchingRows.find(row => row.id === selected.row.id) ?? null : null;
  const openDetail = (row: ReportEntry) => setSelected({ ownerId, key: requestKey, row });
  const draft = ui.draft.filter;
  const incomplete = report.warnings.some(warning => warning.includes("incomplete") || warning.includes("do not reconcile") || warning.includes("omitted"));
  function download() {
    const blob = new Blob([reportEntriesCsv(matchingRows)], { type: "text/csv;charset=utf-8" });
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
        <label>Period<SelectMenu aria-label="Period" value={ui.draft.period} onChange={value => { dispatch({ type: "period", period: value as ReportPeriod, now: new Date() }); dispatch({ type: "apply", now: new Date() }); }} options={[{value:"today",label:"Today"},{value:"seven",label:"Last 7 days"},{value:"thirty",label:"Last 30 days"},{value:"custom",label:"Custom range"}]} /></label>
        {ui.draft.period === "custom" && <><label>From<input type="date" value={draft.from} onChange={event => update("from", event.target.value)} /></label><label>To<input type="date" value={draft.to} onChange={event => update("to", event.target.value)} /></label></>}
        <label>Customer or amount<input type="search" placeholder="Name or ₹ amount" value={search} onChange={event => setSearch(event.target.value)} /></label>
        <label>Entries<SelectMenu aria-label="Entries" value={draft.kind} onChange={value => update("kind", value)} options={["all", "pending_sales", "fully_paid"].map(kind => ({value:kind,label:reportTypeLabels[kind]}))} /></label>
      </div>
      <details className="reports-advanced"><summary>Advanced Filters</summary><div className="reports-filters">
        <label>Sort by<SelectMenu aria-label="Sort by" value={draft.sort} onChange={value => update("sort", value as ReportFilter["sort"])} options={[{value:"date",label:"Date"},{value:"amount",label:"Amount"},{value:"customer",label:"Customer"}]} /></label>
        <label>Order<SelectMenu aria-label="Order" value={draft.descending ? "desc" : "asc"} onChange={value => update("descending", value === "desc")} options={[{value:"desc",label:"Newest / highest first"},{value:"asc",label:"Oldest / lowest first"}]} /></label>
      </div></details>
      {ui.error && <p role="alert" className="reports-filter-error">{ui.error}</p>}
    </form>
    <ReportsMobileTransactions rows={matchingRows.slice(0, ui.visibleCount)} total={matchingRows.length} onSelect={openDetail} />
    <ReportsGroups rows={matchingRows.slice(0, ui.visibleCount)} total={matchingRows.length} onSelect={openDetail} />
    <div className="reports-pagination"><p>Showing {Math.min(ui.visibleCount, matchingRows.length)} of {matchingRows.length} entries</p>{ui.visibleCount < matchingRows.length && <button type="button" className="outline" onClick={() => dispatch({ type: "more" })}>Load 20 More</button>}</div>
    <details className="reports-accounting"><summary>How to read this</summary>
      <p className="reports-semantics">Total sales and Received use the selected dates. Pending covers all active sales. Search and entry status filter the list, CSV and print, while the three cards keep their existing totals.</p>
      <p className="reports-semantics">Leave either custom date blank for an open range. Presets use your local calendar; transactions use UTC dates. Unlinked payments may appear in the list but do not add to Pending.</p>
      {pending && <p role="status" className="reports-notice">Workspace changes are awaiting cloud acknowledgement.</p>}
      {report.warnings.map(warning => <p className="reports-notice" key={warning}>{warning}</p>)}
      <div className="reports-print-context">Applied period: {filter.from || "All dates"} to {filter.to || "All dates"} · Search: {filter.search || "None"} · Entries: {reportTypeLabels[filter.kind] || filter.kind}</div>
    </details>
    <ReportsPrintDocument filter={filter} rows={matchingRows} summary={{ sales: view.sales, payments: view.payments, periodBalance: view.periodBalance, outstanding: report.activeOutstandingPaise }} incomplete={incomplete} warnings={report.warnings} pending={false} ledgerEnabled={false} />
    {detail && <ReportsTransactionDetail row={detail} onClose={() => setSelected(null)} />}
  </section>;
}
