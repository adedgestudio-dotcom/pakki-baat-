const wholeRupees = new Intl.NumberFormat("en-IN", { maximumFractionDigits: 0 });

/** Exact decimal text from integer paise; used by CSV and currency displays. */
export function paiseDecimal(paise: number): string {
  if (!Number.isSafeInteger(paise)) throw new Error("Invalid paise amount.");
  const absolute = Math.abs(paise);
  return `${paise < 0 ? "-" : ""}${Math.trunc(absolute / 100)}.${String(absolute % 100).padStart(2, "0")}`;
}

export function formatMoneyPaise(paise: number): string {
  if (!Number.isSafeInteger(paise)) throw new Error("Invalid paise amount.");
  const absolute = Math.abs(paise);
  return `${paise < 0 ? "-" : ""}₹${wholeRupees.format(Math.trunc(absolute / 100))}.${String(absolute % 100).padStart(2, "0")}`;
}

/** Presentation only: absorb floating-point noise from existing rupee sums/differences.
 * Input acceptance continues to use paymentPaise; this never modifies stored data.
 */
export function formatMoneyRupees(rupees: number): string {
  if (!Number.isFinite(rupees)) throw new Error("Invalid rupee amount.");
  return formatMoneyPaise(Math.round(rupees * 100));
}
