"use client";
import { useEffect, useRef } from "react";
import { formatReportMoney, type ReportEntry } from "@/lib/reports";
export default function ReportsTransactionDetail({ row, onClose }: { row: ReportEntry; onClose: () => void }) {
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => { const element = dialog.current; element?.showModal(); return () => { element?.close(); }; }, []);
  return <dialog className="reports-detail" ref={dialog} onClose={onClose} aria-labelledby="report-detail-title"><button type="button" className="modal-close-x" aria-label="Close" onClick={() => dialog.current?.close()}>×</button><h2 id="report-detail-title">Entry details</h2><dl><div><dt>Customer</dt><dd>{row.customer}</dd></div><div><dt>Work</dt><dd>{row.work}</dd></div><div><dt>Date</dt><dd>{row.day}</dd></div><div><dt>Total</dt><dd>{formatReportMoney(row.totalPaise)}</dd></div><div><dt>Received</dt><dd>{formatReportMoney(row.receivedPaise)}</dd></div><div><dt>Pending</dt><dd>{formatReportMoney(row.pendingPaise)}</dd></div></dl><section aria-label="Payments"><h3>Payments</h3>{row.payments.length ? <ul className="reports-detail-events">{row.payments.map(payment => <li key={payment.id}><time dateTime={payment.date}>{payment.date}</time><span>{formatReportMoney(Math.round(payment.amount * 100))}</span><span>{payment.note || "—"}</span></li>)}</ul> : <p>No payments recorded.</p>}</section><button type="button" className="outline" onClick={() => dialog.current?.close()} autoFocus>Close</button></dialog>;
}
