const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const ts = require("typescript");
const source = fs.readFileSync(path.join(__dirname, "../app/workspace.tsx"), "utf8");
const ast = ts.createSourceFile("workspace.tsx", source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
const declarations = new Map();
function visit(node) {
  if (ts.isVariableDeclaration(node)) declarations.set(node.name.getText(ast), node.initializer);
  ts.forEachChild(node, visit);
}
visit(ast);
function labels(jobs, selectedCustomer) {
  const context = { jobs, selectedCustomer };
  context.customerJobs = vm.runInNewContext(declarations.get("customerJobs").getText(ast), context);
  const result = vm.runInNewContext(declarations.get("customerEntryNumbers").getText(ast), context);
  return Object.fromEntries(result);
}

test("entry labels count oldest creation first per customer without reordering or storing data", () => {
  const jobs = Object.freeze([
    Object.freeze({ id: "new", customer: "Asha", createdAt: "2026-11-10T10:00:00Z", date: "2020-01-01" }),
    Object.freeze({ id: "other", customer: "Meena", createdAt: "2020-01-01T00:00:00Z" }),
    Object.freeze({ id: "old", customer: "Asha", createdAt: "2026-11-09T10:00:00Z", date: "2030-01-01" }),
    Object.freeze({ id: "middle", customer: "Asha", createdAt: "2026-11-10T14:30:00+05:30" }),
  ]);
  const before = JSON.stringify(jobs);
  assert.deepEqual(labels(jobs, "Asha"), { old: 1, middle: 2, new: 3 });
  assert.deepEqual(labels(jobs, "Meena"), { other: 1 });
  assert.deepEqual(labels(jobs, null), {});
  assert.equal(JSON.stringify(jobs), before);
  assert.deepEqual(labels([...jobs].reverse(), "Asha"), labels(jobs, "Asha"));
});

test("equal timestamps and missing legacy timestamps have deterministic labels", () => {
  const jobs = [
    { id: "z", customer: "Asha" },
    { id: "b", customer: "Asha", createdAt: "2026-11-10T00:00:00Z" },
    { id: "y", customer: "Asha", createdAt: "invalid" },
    { id: "a", customer: "Asha", createdAt: "2026-11-10T00:00:00Z" },
  ];
  assert.deepEqual(labels(jobs, "Asha"), { a: 1, b: 2, y: 3, z: 4 });
  assert.deepEqual(labels(jobs.reverse(), "Asha"), { a: 1, b: 2, y: 3, z: 4 });
});

test("entry card renders its computed label with mobile and dark theme styles", () => {
  assert.match(source, /<div className="hisaab-history-summary">\s*<small className="hisaab-entry-number">Entry \{customerEntryNumbers.get\(j.id\)\}<\/small>/);
  const css = fs.readFileSync(path.join(__dirname, "../app/workspace.css"), "utf8");
  assert.match(css, /\.hisaab-history-summary \.hisaab-entry-number \{[^}]*font-size: 12px;[^}]*overflow-wrap: anywhere;/);
  assert.ok(css.includes('[data-theme="dark"] .hisaab-history-summary .hisaab-entry-number'));
});
