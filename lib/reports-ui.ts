import { defaultReportFilter, validReportDay, type ReportFilter, type ReportTransaction } from "./reports";

export type ReportPeriod = "today" | "seven" | "thirty" | "custom";
export type ReportSelection = { period: ReportPeriod; filter: ReportFilter };
export type ReportUiState = { draft: ReportSelection; applied: ReportSelection; visibleCount: number; error: string | null };
export type ReportUiAction =
  | { type: "edit"; filter: Partial<ReportFilter> }
  | { type: "period"; period: ReportPeriod; now: Date }
  | { type: "apply"; now: Date }
  | { type: "more" };

export const reportTypeLabels: Record<string, string> = {
  all: "All Transactions", charge: "Sales", payment: "Payments Received", correction: "Corrections",
  reversal: "Reversals", adjustment: "Adjustments", opening_balance: "Opening Balances",
};
export const advancedReportTypes = ["reversal", "adjustment", "opening_balance"];
export const REPORT_PAGE_SIZE = 20;

function localDay(date: Date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}
export function reportPeriodDates(period: Exclude<ReportPeriod, "custom">, now: Date) {
  // Calendar arithmetic, not UTC ISO slicing or fixed 24-hour subtraction: DST safe.
  const first = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 12);
  first.setDate(first.getDate() - (period === "today" ? 0 : period === "seven" ? 6 : 29));
  return { from: localDay(first), to: localDay(now) };
}
export function createReportUiState(now: Date): ReportUiState {
  const selection: ReportSelection = { period: "thirty", filter: { ...defaultReportFilter, ...reportPeriodDates("thirty", now) } };
  return { draft: { ...selection, filter: { ...selection.filter } }, applied: selection, visibleCount: REPORT_PAGE_SIZE, error: null };
}
export function reportFiltersPending(state: ReportUiState) {
  return JSON.stringify(state.draft) !== JSON.stringify(state.applied);
}
export function reportUiReducer(state: ReportUiState, action: ReportUiAction): ReportUiState {
  if (action.type === "more") return { ...state, visibleCount: state.visibleCount + REPORT_PAGE_SIZE };
  if (action.type === "edit") return { ...state, draft: { ...state.draft, filter: { ...state.draft.filter, ...action.filter } }, error: null };
  if (action.type === "period") return {
    ...state, error: null,
    draft: { period: action.period, filter: { ...state.draft.filter, ...(action.period === "custom" ? {} : reportPeriodDates(action.period, action.now)) } },
  };
  // Re-evaluate relative presets on confirmation, including across local midnight.
  const draft = state.draft.period === "custom" ? state.draft : {
    ...state.draft, filter: { ...state.draft.filter, ...reportPeriodDates(state.draft.period, action.now) },
  };
  const { from, to } = draft.filter;
  if ((from && !validReportDay(from)) || (to && !validReportDay(to)) || (from && to && from > to)) {
    return { ...state, error: "Choose valid dates, with From on or before To. Your displayed report has not changed." };
  }
  return { draft, applied: { ...draft, filter: { ...draft.filter } }, visibleCount: REPORT_PAGE_SIZE, error: null };
}

// Only presentation order changes. Existing date-range and accounting semantics stay intact.
export function orderReportDates(rows: ReportTransaction[], filter: ReportFilter, timestamps: Map<string, number>) {
  if (filter.sort !== "date") return rows;
  return [...rows].sort((a, b) => (
    a.day.localeCompare(b.day) || (timestamps.get(a.id) || 0) - (timestamps.get(b.id) || 0) || a.id.localeCompare(b.id)
  ) * (filter.descending ? -1 : 1));
}
