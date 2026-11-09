"use client";

import { useEffect, useRef } from "react";
import type { Job } from "@/lib/data";
import { formatMoneyRupees } from "@/lib/money";
import { formatReportMoney, type ReportTransaction } from "@/lib/reports";
import { reportBakiLabel, reportTypeLabels } from "@/lib/reports-ui";

export default function ReportsTransactionDetail({ row, job, onClose }: { row: ReportTransaction; job?: Job; onClose: () => void }) {
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
      <div><dt>Type</dt><dd>{reportTypeLabels[row.kind] || row.kind}</dd></div>
      <div><dt>Amount</dt><dd>{formatReportMoney(row.amountPaise)}</dd></div>
      <div><dt>Description</dt><dd>{row.description}</dd></div>
    </dl>
    <p>{reportBakiLabel(row)}</p>
    {job ? <section aria-label="Current sale totals"><h3>Current sale totals</h3><p>{job.work}</p><dl>
      <div><dt>Total</dt><dd>{formatMoneyRupees(job.total)}</dd></div>
      <div><dt>Received so far</dt><dd>{formatMoneyRupees(job.paid)}</dd></div>
      <div><dt>Baki</dt><dd>{formatMoneyRupees(Math.max(0, job.total - job.paid))}</dd></div>
    </dl></section> : <p>The linked sale is unavailable (historical or unlinked transaction).</p>}
    <button type="button" className="outline" onClick={() => dialog.current?.close()} autoFocus>Close</button>
  </dialog>;
}
