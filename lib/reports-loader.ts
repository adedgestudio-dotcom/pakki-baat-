import type { LedgerRow } from "./reports";

// No session persistence, refresh, writes, or cached account data in this reader.
export async function readReportLedger(ownerId: string, sessionOwner: () => Promise<string>, page: (offset: number) => Promise<{ rows: LedgerRow[]; total: number }>) {
  if (!ownerId || await sessionOwner() !== ownerId) throw Error("ACCOUNT_CHANGED: reload Reports after signing in.");
  const rows: LedgerRow[] = [];
  let total: number | undefined;
  const ids = new Set<string>();
  do {
    const result = await page(rows.length);
    if (!Number.isSafeInteger(result.total) || result.total < 0 || result.total > 100000 || total !== undefined && total !== result.total) throw Error("Ledger changed or is too large. Reload Reports; no partial totals were used.");
    total = result.total;
    for (const row of result.rows) {
      if (row.owner_id !== ownerId || ids.has(row.id)) throw Error("Invalid account or duplicate ledger page.");
      ids.add(row.id);
      rows.push(row);
    }
    if (rows.length > total || !result.rows.length && rows.length < total) throw Error("Incomplete ledger history; totals are unavailable.");
    if (await sessionOwner() !== ownerId) throw Error("ACCOUNT_CHANGED: reload Reports after signing in.");
  } while (rows.length < total);
  return rows;
}
