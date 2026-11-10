"use client";

import { useEffect, useRef } from "react";
import { formatReportMoney, type ReportTransaction } from "@/lib/reports";
import type { ReportGroup } from "@/lib/reports-groups";

const typeLabel: Record<string, string> = { charge: "Sale", payment: "Payment received", correction: "Correction", reversal: "Correction", adjustment: "Other", opening_balance: "Other" };

export default function ReportsTransactionDetail({ row, group, onClose }: { row: ReportTransaction; group?: ReportGroup; onClose: () => void }) {
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const element = dialog.current;
    element?.showModal();
    return () => { element?.close(); };
  }, []);
  return <dialog className="reports-detail" ref={dialog} onClose={onClose} aria-labelledby="report-detail-title">
    <h2 id="report-detail-title">Transaction details</h2>
    <dl>
      <div><dt>Customer</dt><dd>{row.customer}</dd></div>
      <div><dt>Date (UTC)</dt><dd>{row.day}</dd></div>
      <div><dt>Type</dt><dd>{typeLabel[row.kind] || row.kind.replaceAll("_", " ")}</dd></div>
      <div><dt>Amount</dt><dd>{formatReportMoney(row.amountPaise)}</dd></div>
      <div><dt>Description</dt><dd>{row.description}</dd></div>
    </dl>
    {group?.lifetime && <section aria-label="Sale"><h3>Sale{group.job?.work ? ` · ${group.job.work}` : ""}</h3><dl>
      <div><dt>Total</dt><dd>{formatReportMoney(group.lifetime.totalPaise)}</dd></div>
      <div><dt>Received</dt><dd>{formatReportMoney(group.lifetime.receivedPaise)}</dd></div>
      <div><dt>Pending</dt><dd>{formatReportMoney(group.lifetime.bakiPaise)}</dd></div>
    </dl></section>}
    {group && <section aria-label="Sale and payment history"><h3>Sale and payment history</h3><ul className="reports-detail-events">{group.events.map(event => <li key={event.row.id}>
      <strong>{event.role === "Receipt" ? "Payment received" : event.role === "Reversal" || event.role === "Replacement" ? "Correction" : event.role}</strong>
      <time dateTime={event.row.day}>{event.row.day}</time><span>{formatReportMoney(event.row.amountPaise)}</span>
    </li>)}</ul></section>}
    <button type="button" className="outline" onClick={() => dialog.current?.close()} autoFocus>Close</button>
  </dialog>;
}
