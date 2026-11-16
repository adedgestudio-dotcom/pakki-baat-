const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const ts = require("typescript");
const cache = new Map();
function load(name) {
  if (cache.has(name)) return cache.get(name);
  const exports = {};
  cache.set(name, exports);
  const code = ts.transpileModule(fs.readFileSync(path.join(__dirname, "../lib", name + ".ts"), "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  vm.runInNewContext(code, { exports, require: relative => load(relative.replace("./", "")), Intl });
  return exports;
}
const reports = load("reports"), ui = load("reports-ui");
const snapshot = { owner: "Owner", business: "Test", jobs: [
  { id: "j", customer: "Asha Shah", work: "Cake", total: 100, paid: 20, createdAt: "2026-11-09T12:00:00Z", date: "2026-11-09" },
  { id: "b", customer: "Basha", work: "Cake", total: 50, paid: 0, createdAt: "2026-11-09T12:00:00Z", date: "2026-11-09" },
], payments: [{ id: "p", jobId: "j", customer: "Asha Shah", amount: 20, date: "2026-11-09", createdAt: "2026-11-09T13:00:00Z" }] };
const report = reports.legacyReport(snapshot);
const select = filter => reports.selectReport(report, { ...reports.defaultReportFilter, ...filter });

test("entry rows combine linked payments, retain summaries and export the displayed values", () => {
  const data = { ...snapshot, payments: [...snapshot.payments,
    { id: 'later', jobId: 'j', customer: 'Asha Shah', amount: 3, date: '2026-11-11', createdAt: '2026-11-11T10:00:00Z', note: 'later' },
    { id: 'unlinked', customer: 'Asha Shah', amount: 5, date: '2026-11-10', createdAt: '2026-11-10T10:00:00Z', note: 'cash' },
  ] };
  const filter = { ...reports.defaultReportFilter, from: '2026-11-09', to: '2026-11-11' };
  const rows = reports.selectReportEntries(data, filter);
  assert.equal(rows.length, 3);
  assert.equal(rows.filter(row => row.id.startsWith('job:')).length, 2);
  const entry = rows.find(row => row.id === 'job:j');
  assert.deepEqual(Array.from(entry.payments, payment => payment.id), ['p', 'later']);
  assert.equal(entry.totalPaise, 10000); assert.equal(entry.receivedPaise, 2000); assert.equal(entry.pendingPaise, 8000);
  assert.equal(rows.find(row => row.id === 'payment:unlinked').work, 'Payment received');
  const previous = reports.selectReport(reports.legacyReport(data), filter);
  assert.equal(previous.sales, 15000); assert.equal(previous.payments, 2800); assert.equal(reports.legacyReport(data).activeOutstandingPaise, 13000);
  const csv = reports.reportEntriesCsv(rows);
  assert.match(csv, /^\uFEFFDate,Customer,Work,Total,Received,Pending/);
  assert.equal(csv.split('\r\n').length, rows.length + 1);
});

test("entry filters use job balances, entry dates, and stable newest-first order", () => {
  const data = { ...snapshot, jobs: [...snapshot.jobs, { ...snapshot.jobs[0], id: 'z', paid: 100, date: '2026-11-08', createdAt: '2026-11-12T00:00:00Z' }, { ...snapshot.jobs[0], id: 'zero', total: 0, paid: 0, date: '2026-11-07' }] };
  const filter = { ...reports.defaultReportFilter };
  assert.deepEqual(Array.from(reports.selectReportEntries(data, filter), row => row.id), ['job:j', 'job:b', 'job:z', 'job:zero']);
  assert.deepEqual(Array.from(reports.selectReportEntries(data, { ...filter, kind: 'pending_sales' }), row => row.id), ['job:j', 'job:b']);
  assert.deepEqual(Array.from(reports.selectReportEntries(data, { ...filter, kind: 'fully_paid' }), row => row.id), ['job:z']);
  assert.deepEqual(Array.from(reports.selectReportEntries(data, { ...filter, from: '2026-11-09', search: 'Cake' }), row => row.id), ['job:j', 'job:b']);
});

test("summary totals match the filtered entry rows for all, pending and fully paid", () => {
  const data = { ...snapshot, jobs: [...snapshot.jobs, { ...snapshot.jobs[0], id: 'paid', paid: 100 }, { ...snapshot.jobs[0], id: 'zero', total: 0, paid: 0 }], payments: [...snapshot.payments, { id: 'extra', customer: 'Asha Shah', amount: 7, date: '2026-11-09', createdAt: '2026-11-09T14:00:00Z' }] };
  for (const kind of ['all', 'pending_sales', 'fully_paid']) {
    const rows = reports.selectReportEntries(data, { ...reports.defaultReportFilter, kind, search: 'Asha', from: '2026-11-09', to: '2026-11-09' });
    const totals = reports.summarizeReportEntries(rows);
    assert.equal(totals.sales, rows.reduce((sum, row) => sum + row.totalPaise, 0));
    assert.equal(totals.payments, rows.reduce((sum, row) => sum + row.receivedPaise, 0));
    assert.equal(totals.outstanding, rows.reduce((sum, row) => sum + row.pendingPaise, 0));
    const expected = { all: [20000, 12700, 8000], pending_sales: [10000, 2000, 8000], fully_paid: [10000, 10000, 0] }[kind];
    assert.deepEqual([totals.sales, totals.payments, totals.outstanding], expected);
    if (kind === 'pending_sales') assert.ok(rows.every(row => row.pendingPaise > 0));
    if (kind === 'fully_paid') assert.ok(rows.every(row => row.pendingPaise === 0 && row.totalPaise > 0));
  }
});

test("report filter edits remain drafts until Show Report applies them", () => {
  const now = new Date(2026, 10, 9);
  let state = ui.createReportUiState(now);
  state = ui.reportUiReducer(state, { type: 'edit', filter: { kind: 'fully_paid', search: 'Asha' } });
  assert.equal(state.applied.filter.kind, 'all'); assert.equal(state.applied.filter.search, '');
  assert.equal(ui.reportFiltersPending(state), true);
  state = ui.reportUiReducer(state, { type: 'apply', now });
  assert.equal(state.applied.filter.kind, 'fully_paid'); assert.equal(state.applied.filter.search, 'Asha');
  assert.equal(ui.reportFiltersPending(state), false);
});

test("workspace reports follow the current snapshot after restore and sort consistently", () => {
  const first = reports.selectReport(reports.legacyReport(snapshot), reports.defaultReportFilter);
  assert.equal(first.sales, 15000);
  assert.equal(first.payments, 2000);
  assert.deepEqual(Array.from(first.rows, row => row.id), ["payment:p", "job:j", "job:b"]);
  const restored = { ...snapshot, jobs: [snapshot.jobs[1]], payments: [] };
  const restoredReport = reports.legacyReport(restored);
  assert.deepEqual(Array.from(reports.selectReport(restoredReport, reports.defaultReportFilter).rows, row => row.id), ["job:b"]);
  assert.equal(reports.selectReport(restoredReport, reports.defaultReportFilter).sales, 5000);
  assert.equal(reports.selectReport(restoredReport, reports.defaultReportFilter).payments, 0);
  assert.equal(restoredReport.warnings.length, 0);
  for (const sort of ["date", "amount", "customer"]) for (const descending of [true, false]) {
    const filter = { ...reports.defaultReportFilter, sort, descending };
    assert.deepEqual(Array.from(reports.selectReport(report, filter).rows, row => row.id), Array.from(reports.selectReport(report, filter).rows, row => row.id));
  }
});

test("Reports customer search matches word starts, never interior substrings; amounts still match", () => {
  for (const search of ["Asha", "ASHA", "Ash", "Shah", "asha sh"]) {
    assert.ok(select({ search }).rows.length > 0);
    assert.ok(select({ search }).rows.every(row => row.customer === "Asha Shah"));
  }
  assert.equal(select({ search: "ha" }).rows.length, 0);
  assert.equal(select({ search: "100" }).rows[0].amountPaise, 10000);
  assert.equal(select({ search: "20" }).rows[0].kind, "payment");
  assert.equal(select({ search: "not a customer" }).rows.length, 0);
});

test("each applied Transactions option filters rows while summary totals stay identical", () => {
  const full = { ...report, rows: [...report.rows,
    { ...report.rows[0], id: "c", kind: "correction", salesEffect: 0, paymentEffect: 0 },
    { ...report.rows[0], id: "r", kind: "reversal", salesEffect: 0, paymentEffect: 0 },
  ] };
  for (const [kind, expected] of [["all",5],["charge",2],["payment",1],["correction",2]]) {
    let state = ui.createReportUiState(new Date(2026,10,9));
    state = ui.reportUiReducer(state, { type: "edit", filter: { kind } });
    state = ui.reportUiReducer(state, { type: "apply", now: new Date(2026,10,9) });
    const view = reports.selectReport(full, state.applied.filter);
    assert.equal(view.rows.length, expected, kind);
    assert.equal(view.sales, 15000);
    assert.equal(view.payments, 2000);
    assert.equal(view.periodBalance, 13000);
  }
});

test("print Baki wording still follows signed accounting effects including reversals", () => {
  assert.match(ui.reportBakiLabel(report.rows[0]), /^Baki increases by Rs 100/);
  assert.match(ui.reportBakiLabel(report.rows.at(-1)), /^Baki reduces by Rs 20/);
  assert.match(ui.reportBakiLabel({ ...report.rows[0], salesEffect: -10000 }), /^Baki reduces by Rs 100/);
  assert.equal(ui.reportBakiLabel({ ...report.rows[0], unclassified: true }), "Baki change is unclassified");
});

test("read-only detail resolves linked jobs without changing transaction amounts", () => {
  assert.equal(ui.reportJobId(report.rows[0], snapshot.payments), "j");
  assert.equal(ui.reportJobId(report.rows.at(-1), snapshot.payments), "j");
  assert.equal(ui.reportJobId({ id: "ledger" }, [], [{ id: "ledger", job_id: "j" }]), "j");
  assert.equal(ui.reportJobId({ id: "missing" }, [], []), undefined);
  const detail = fs.readFileSync(path.join(__dirname, "../app/reports-detail.tsx"), "utf8");
  assert.match(detail, /<dialog/);
  for (const label of ["Customer", "Date", "Work", "Total", "Received", "Pending", "Payments"]) assert.ok(detail.includes(">" + label + "<"), label);
  assert.ok(!/fetch\(|<input|<select|Edit|Delete/.test(detail));
  assert.equal((detail.match(/<button/g) || []).length, 2);
});

test("offline notices and long reconciliation labels cannot widen the same report grid", () => {
  const css = fs.readFileSync(path.join(__dirname, "../app/reports.css"), "utf8");
  const screen = fs.readFileSync(path.join(__dirname, "../app/reports.tsx"), "utf8");
  const mobile = fs.readFileSync(path.join(__dirname, "../app/reports-mobile.tsx"), "utf8");
  const print = fs.readFileSync(path.join(__dirname, "../app/reports-print.tsx"), "utf8");
  assert.match(css, /\.reports-page\{width:100%;grid-template-columns:minmax\(0,1fr\)\}/);
  assert.match(css, /\.reports-notice,\.reports-overview strong\{overflow-wrap:anywhere\}/);
  assert.match(css, /\.reports-overview>\.panel\{min-width:0;min-height:100px;align-content:start\}/);
  assert.match(css, /\.reports-overview\{grid-template-columns:repeat\(3,minmax\(0,1fr\)\)\}/);
  assert.ok(!screen.includes('["Period Balance"'));
  assert.ok(!print.includes('["Period Balance"'));
  assert.ok(![screen,mobile,print].some(source => source.includes("Balance effect")));
  assert.match(screen, /onSelect=\{openDetail\}/);
  assert.match(screen, /selected\?\.ownerId === ownerId && selected.key === requestKey/);
});

test("rule 16 and the quantity/rate eval cases are present without running the eval", () => {
  const route = fs.readFileSync(path.join(__dirname, "../app/api/process-message/route.ts"), "utf8");
  const script = fs.readFileSync(path.join(__dirname, "../scripts/eval-assistant.mjs"), "utf8");
  assert.match(route, /16\. When both a quantity and its per-unit rate are given, total = quantity x rate/);
  for (const [text, total, paid] of [
    ["Asha ne 5 kg cake order kiya 750 per kg, 100 advance diya", 3750, 100],
    ["2 kg barfi 600 per kg for Meena", 1200],
    ["Raju ka 3 dozen ladoo 200 per dozen, 100 advance", 600, 100],
  ]) {
    const line = script.split("\n").find(line => line.includes(text));
    assert.ok(line);
    assert.ok(line.includes("total: " + total));
    if (paid) assert.ok(line.includes("paid: " + paid));
  }
});

test("every Reports message card shares padding and heading sizing", () => {
  const screen = fs.readFileSync(path.join(__dirname, "../app/reports.tsx"), "utf8");
  const css = fs.readFileSync(path.join(__dirname, "../app/reports.css"), "utf8");
  const states = screen.match(/<section className="panel reports-page reports-state"[^>]*>[\s\S]*?<\/section>/g);
  assert.equal(states.length, 2);
  for (const message of ["Sign in and load your workspace", "Report unavailable."]) {
    assert.ok(states.some(state => state.includes(message)), message);
  }
  assert.ok(!screen.includes('className="panel reports-page"'));
  assert.ok(css.includes('.panel.reports-page.reports-state{padding:20px;gap:12px;align-content:start}'));
  assert.ok(css.includes('.reports-state h1{margin:0;font-size:26px;line-height:1.3}'));
  assert.ok(css.includes('.panel.reports-page.reports-state{padding:16px}'));
  assert.ok(css.includes('.reports-state h1{font-size:23px}'));
  assert.ok(css.includes('.reports-page .reports-empty{margin:0;padding:16px;'));
  assert.ok(css.includes('.reports-page .reports-notice,.reports-page .reports-filter-error{padding:14px;'));
});


test("on-screen Reports omit per-event balance text and empty placeholders", () => {
  for (const file of ["reports.tsx", "reports-groups.tsx", "reports-mobile.tsx", "reports-detail.tsx"]) {
    const source = fs.readFileSync(path.join(__dirname, "../app", file), "utf8");
    assert.doesNotMatch(source, /reportBakiLabel|Balance effect|Baki change|Baki increases|Baki reduces|reports-card-effect/, file);
    assert.doesNotMatch(source, /<(?:th|td|p)(?:\s[^>]*)?>\s*<\/(?:th|td|p)>/, file);
  }
  const css = fs.readFileSync(path.join(__dirname, "../app/reports.css"), "utf8");
  assert.ok(!css.includes(".reports-card-effect"));
  const React = require("react");
  const { renderToStaticMarkup } = require("react-dom/server");
  const entries = reports.selectReportEntries(snapshot, reports.defaultReportFilter);
  for (const file of ["reports-mobile", "reports-detail"]) {
    const source = fs.readFileSync(path.join(__dirname, "../app", file + ".tsx"), "utf8");
    const output = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX } }).outputText;
    const exports = {};
    vm.runInNewContext(output, { exports, require: name => name.startsWith("@/lib/") ? load(name.slice(6)) : require(name) });
    const markup = renderToStaticMarkup(React.createElement(exports.default, { rows: entries, total: entries.length, row: entries.find(row => row.customer === 'Asha Shah'), onSelect() {}, onClose() {} }));
    assert.doesNotMatch(markup, /Balance effect|Baki change|Baki increases|Baki reduces/);
    for (const text of ["Asha Shah", reports.formatReportMoney(report.rows[0].amountPaise)]) assert.ok(markup.includes(text), file + ": " + text);
    if (file === "reports-detail") {
      for (const text of ["Cake", "Date", "Work", "Payments", "Received", "Pending"]) assert.ok(markup.includes(text), text);
    } else {
      assert.ok(markup.includes('dateTime="2026-11-09"'));
      assert.ok(markup.includes("Cake"));
    }
  }
});
