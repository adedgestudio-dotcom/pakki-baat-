"use client";

import type { Payment } from "@/lib/data";
import { formatMoneyRupees } from "@/lib/money";

const correctionReasons = {
  wrong_amount: "Wrong amount",
  duplicate: "Duplicate entry",
  data_entry_error: "Data entry error",
  other: "Other",
};

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
        <ul>
          {payments.map(payment => (
            <li key={payment.id}>
              <div>
                <strong>{formatMoneyRupees(payment.amount)}</strong>
                <small>{payment.date}{payment.note ? ` · ${payment.note}` : ""}</small>
                {payment.correctionReason && (
                  <small>Corrected · {correctionReasons[payment.correctionReason]}{payment.correctionNote ? ` · ${payment.correctionNote}` : ""}</small>
                )}
              </div>
              <button type="button" className="card-action" disabled={readOnly} onClick={() => onCorrect(payment)}>
                Correct payment
              </button>
            </li>
          ))}
        </ul>
      )}
      {onViewLedger && <button type="button" className="text-button" onClick={onViewLedger}>View ledger history</button>}
    </section>
  );
}
