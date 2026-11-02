import type { Job, Payment } from "./data";

/** Parse decimal input without rounding fractional paise or accepting exponent notation. */
export function paymentPaise(value: string | number): number {
  const text = String(value).trim();
  if (!/^(?:\d+(?:\.\d{1,2})?|\.\d{1,2})$/.test(text)) {
    throw new Error("Enter an amount with at most two decimal places.");
  }
  const [whole, fraction = ""] = text.split(".");
  const paise = Number(whole || "0") * 100 + Number(fraction.padEnd(2, "0"));
  if (!Number.isSafeInteger(paise) || paise < 0 ||
      Math.round((paise / 100) * 100) !== paise) throw new Error("Amount is too large to record safely.");
  return paise;
}

export function paymentRupees(paise: number): number {
  if (!Number.isSafeInteger(paise) || paise < 0) throw new Error("Invalid payment amount.");
  const rupees = paise / 100;
  if (paymentPaise(rupees) !== paise) throw new Error("Amount is too large to record safely.");
  return rupees;
}

export function validateEntryMoney(job: Pick<Job, "total" | "paid">) {
  if (paymentPaise(job.paid) > paymentPaise(job.total)) throw new Error("Received amount cannot exceed the charge.");
}

export type FinancialState = { jobs: Job[]; payments: Payment[] };

export function planQuickPayment(state: FinancialState, expected: Job, raw: string, payment: Payment): FinancialState {
  const current = state.jobs.find(job => job.id === expected.id);
  if (!current || current.customer !== expected.customer || current.total !== expected.total || current.paid !== expected.paid) {
    throw new Error("This entry changed after the payment dialog opened. Reopen it before confirming.");
  }
  validateEntryMoney(current);
  const related = state.payments.filter(item => item.jobId === current.id);
  if (new Set(related.map(item => item.id)).size !== related.length || related.some(item => item.customer !== current.customer)) {
    throw new Error("Duplicate or mismatched payment history needs review.");
  }
  const recorded = related.reduce((sum, item) => sum + paymentPaise(item.amount), 0);
  if (!Number.isSafeInteger(recorded) || recorded !== paymentPaise(current.paid)) {
    throw new Error("Payment history and received amount do not agree. Review the entry first.");
  }
  const amount = paymentPaise(raw);
  if (amount === 0) throw new Error("Payments must be greater than zero.");
  if (state.payments.some(item => item.id === payment.id)) throw new Error("Duplicate payment submission.");
  if (payment.jobId !== current.id || payment.customer !== current.customer || paymentPaise(payment.amount) !== amount) {
    throw new Error("Payment must match the current entry.");
  }
  const paid = paymentPaise(current.paid) + amount;
  if (!Number.isSafeInteger(paid) || paid > paymentPaise(current.total)) throw new Error("Payment exceeds the current baki. No amount was recorded.");
  return {
    jobs: state.jobs.map(job => job.id === current.id ? { ...job, paid: paymentRupees(paid) } : job),
    payments: [payment, ...state.payments],
  };
}

export function planPaymentCorrection(state: FinancialState, expected: Payment, raw: string, reason: Payment["correctionReason"], note: string): FinancialState {
  const current = state.payments.find(payment => payment.id === expected.id);
  if (!current || current.amount !== expected.amount || current.customer !== expected.customer || current.jobId !== expected.jobId) {
    throw new Error("This payment changed after the correction dialog opened. Reopen it before confirming.");
  }
  const amount = paymentPaise(raw);
  if (amount === paymentPaise(current.amount)) throw new Error("The amount hasn't changed.");
  if (note.trim().length > 500) throw new Error("Correction note is too long (max 500 characters).");
  const job = state.jobs.find(item => item.id === current.jobId);
  if (!job || job.customer !== current.customer) throw new Error("The payment's entry is unavailable. Review its history before correcting it.");
  const related = state.payments.filter(item => item.jobId === job.id);
  if (new Set(related.map(item => item.id)).size !== related.length) throw new Error("Duplicate payment history needs review.");
  const sum = related.reduce((total, item) => total + paymentPaise(item.amount), 0);
  if (!Number.isSafeInteger(sum) || sum !== paymentPaise(job.paid)) throw new Error("Payment history and received amount do not agree. Review the entry first.");
  const paid = sum - paymentPaise(current.amount) + amount;
  if (!Number.isSafeInteger(paid) || paid > paymentPaise(job.total)) throw new Error("Correction exceeds the current charge.");
  return {
    jobs: state.jobs.map(item => item.id === job.id ? { ...item, paid: paymentRupees(paid) } : item),
    payments: amount === 0 ? state.payments.filter(item => item.id !== current.id) : state.payments.map(item => item.id === current.id ? { ...item, amount: paymentRupees(amount), correctionReason: reason, correctionNote: note.trim() || undefined } : item),
  };
}
