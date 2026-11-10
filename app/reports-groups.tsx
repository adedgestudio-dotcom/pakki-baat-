import { formatReportMoney, type ReportTransaction } from "@/lib/reports";
import type { ReportGroup } from "@/lib/reports-groups";

const typeLabel: Record<string, string> = { charge: "Sale", payment: "Payment received", correction: "Correction", reversal: "Correction", adjustment: "Other", opening_balance: "Other" };

export default function ReportsGroups({ rows, groups, total, onSelect }: {
  rows: ReportTransaction[]; groups: ReportGroup[]; total: number; onSelect: (row: ReportTransaction) => void;
}) {
  const byRow = new Map(groups.flatMap(group => group.matches.map(row => [row.id, group] as const)));
  return <section className="reports-table-wrap" aria-label="Transactions">
    <table><caption>Transactions ({total})</caption><thead><tr><th scope="col">Customer</th><th scope="col">Date</th><th scope="col">Type</th><th scope="col">Amount</th><th scope="col">Pending</th></tr></thead>
      <tbody>{rows.map(row => {
        const group = byRow.get(row.id);
        return <tr key={row.id} onClick={() => onSelect(row)}>
          <td><button type="button" className="reports-row-button" onClick={event => { event.stopPropagation(); onSelect(row); }} aria-label={`View ${row.customer} transaction`}>{row.customer}</button></td>
          <td><time dateTime={row.day}>{row.day}</time></td>
          <td>{typeLabel[row.kind] || row.kind.replaceAll("_", " ")}</td>
          <td className="reports-amount">{formatReportMoney(row.amountPaise)}</td>
          <td className="reports-amount">{group?.lifetime ? formatReportMoney(group.lifetime.bakiPaise) : "No linked sale"}</td>
        </tr>;
      })}</tbody>
    </table>
    {!rows.length && <p className="reports-empty">No transactions match these filters.</p>}
  </section>;
}
