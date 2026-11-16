"use client";
export default function ChatEntryFields({ customer, onTotal, placement = "before" }: { customer: string; onTotal: (amount: string) => void; placement?: "before" | "after" }) {
  return <>
    {placement === "before" && <label>Customer<input value={customer} readOnly /></label>}
  </>;
}
