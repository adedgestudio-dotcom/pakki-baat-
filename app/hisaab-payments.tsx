"use client";

import type { Payment } from "@/lib/data";
import { formatMoneyRupees } from "@/lib/money";

const correctionReasons = {
  wrong_amount: "Wrong amount",
  duplicate: "Duplicate entry",
  data_entry_error: "Data entry error",
  other: "Other",
};

// "2026-11-02" -> "2 Nov"; anything that is not a plain ISO date is shown as stored.
function shortDate(date: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return date;
  const parsed = new Date(`${date}T00:00:00`);
  if (Number.isNaN(parsed.getTime())) return date;
  return parsed.toLocaleDateString("en-IN", { day: "numeric", month: "short" });
}

export default function HisaabPayments({ payments, readOnly, onCorrect, onViewLedger }: {
  payments: Payment[];
  readOnly: boolean;
  onCorrect: (payment: Payment) => void;
  onViewLedger?: () => void;
}) {
  return (
    <section className="hisaab-payment-history" aria-label="Payment history">
      <h3>Payments received</h3>
      {payments.length === 0 ? <p>No payment records for this entry.</p> : (
        <>
          <p className="hisaab-payment-help">Typed the wrong amount? Tap Fix amount. The old entry stays in your history.</p>
          <ul>
            {payments.map(payment => (
              <li key={payment.id}>
                <div>
                  <span className="hisaab-payment-line">
                    <strong>{formatMoneyRupees(payment.amount)}</strong>
                    {` · ${shortDate(payment.date)}`}
                    {payment.note ? ` · ${payment.note}` : ""}
                  </span>
                  {payment.correctionReason && (
                    <small>Corrected · {correctionReasons[payment.correctionReason]}{payment.correctionNote ? ` · ${payment.correctionNote}` : ""}</small>
                  )}
                </div>
                <button type="button" className="hisaab-fix-amount" aria-label={`Fix amount of ${formatMoneyRupees(payment.amount)}`} disabled={readOnly} onClick={() => onCorrect(payment)}>
                  Fix amount
                </button>
              </li>
            ))}
          </ul>
        </>
      )}
      {onViewLedger && <button type="button" className="text-button" onClick={onViewLedger}>See history of changes</button>}
    </section>
  );
}
