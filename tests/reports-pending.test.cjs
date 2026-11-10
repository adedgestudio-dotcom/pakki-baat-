const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const ts = require("typescript");
const modules = new Map();
function load(name) {
  if (modules.has(name)) return modules.get(name);
  const exports = {};
  modules.set(name, exports);
  const source = fs.readFileSync(path.join(__dirname, "../lib", name + ".ts"), "utf8");
  const output = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  vm.runInNewContext(output, { exports, require: name => load(name.replace("./", "")), Intl });
  return exports;
}
const reports = load("reports");
const { groupReportRows, pendingReportJobIds } = load("reports-groups");
const owner = "owner";
const snapshot = { owner: "Owner", business: "Test", jobs: [
  { id: "paid", customer: "Basha", work: "Cake", total: 100, paid: 100, date: "2026-11-01" },
  { id: "pending", customer: "Asha", work: "Cake", total: 200, paid: 50, date: "2026-11-01" },
], payments: [
  { id: "paid-receipt", jobId: "paid", customer: "Basha", amount: 100, date: "2026-11-02" },
  { id: "pending-receipt", jobId: "pending", customer: "Asha", amount: 50, date: "2026-11-02" },
] };
const report = reports.legacyReport(snapshot);
function selected(kind, search = "") {
  const filter = { ...reports.defaultReportFilter, kind, search };
  const allFilter = { ...filter, kind: "all" };
  const candidates = groupReportRows(owner, report, snapshot, reports.selectReport(report, allFilter).rows, allFilter);
  const pendingJobs = pendingReportJobIds(candidates);
  const ids = new Set(candidates.filter(group => group.jobId && pendingJobs.has(group.jobId)).flatMap(group => group.matches.map(row => row.id)));
  const view = reports.selectReport(report, filter, ids);
  return { view, groups: groupReportRows(owner, report, snapshot, view.rows, filter), ids };
}
test("Pending sales selects only rows of jobs with lifetime baki and exports those rows", () => {
  const { view, groups } = selected("pending_sales");
  assert.deepEqual(Array.from(view.rows, row => row.id).sort(), ["job:pending", "payment:pending-receipt"]);
  assert.deepEqual(Array.from(groups, group => group.jobId), ["pending"]);
  assert.equal(groups[0].lifetime.bakiPaise, 15000);
  const csv = reports.reportCsv(view.rows);
  assert.equal(csv.split("\r\n").length, 3);
  assert.ok(csv.includes("Asha"));
  assert.ok(!csv.includes("Basha"));
  assert.deepEqual([view.sales, view.payments], [30000, 15000]);
});
test("Search applies on top; other types and their CSV bytes remain unchanged", () => {
  assert.deepEqual(Array.from(selected("pending_sales", "Bash").view.rows), []);
  assert.deepEqual(Array.from(selected("pending_sales", "Ash").view.rows, row => row.id).sort(), ["job:pending", "payment:pending-receipt"]);
  for (const kind of ["all", "charge", "payment", "correction"]) {
    const filter = { ...reports.defaultReportFilter, kind };
    const actual = selected(kind).view.rows;
    const before = reports.selectReport(report, filter).rows;
    assert.deepEqual(Array.from(actual, row => row.id), Array.from(before, row => row.id));
    assert.equal(reports.reportCsv(actual), reports.reportCsv(before));
  }
});
