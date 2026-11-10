"use client";
import { useState } from "react";

// Optional calculator for the existing total field; the existing form remains
// responsible for validating and saving the entry.
export default function ChatEntryFields({ customer, onTotal, placement = "before" }: { customer: string; onTotal: (amount: string) => void; placement?: "before" | "after" }) {
  const [quantity, setQuantity] = useState("");
  const [rate, setRate] = useState("");
  function update(nextQuantity: string, nextRate: string) {
    setQuantity(nextQuantity); setRate(nextRate);
    if (!nextQuantity || !nextRate) return;
    const total = Number(nextQuantity) * Number(nextRate);
    if (Number.isFinite(total) && total >= 0) onTotal(total.toFixed(2));
  }
  return <>
    {placement === "before" && <label>Customer<input value={customer} readOnly /></label>}
    {placement === "after" && <div className="inline-form-grid">
      <label>Quantity (optional)<input type="number" min="0" step="0.001" inputMode="decimal" value={quantity} onChange={e => update(e.target.value, rate)} /></label>
      <label>Rate (₹, optional)<input type="number" min="0" step="0.01" inputMode="decimal" value={rate} onChange={e => update(quantity, e.target.value)} /></label>
    </div>}
  </>;
}
