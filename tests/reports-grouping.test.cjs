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
const flat = load("reports"), { groupReportRows } = load("reports-groups");
const owner = "owner";
function job(id, total, paid, customer = "Asha") {
  return { id, customer, work: "Cake", total, paid, date: "2026-11-01", createdAt: "2026-11-01T12:00:00Z" };
}
function entry(id, jobId, kind, amount, day = "2026-11-01", extra = {}) {
  return { id, owner_id: owner, job_id: jobId, customer_name: "Asha", transaction_kind: kind, amount_paise: amount, occurred_at: day + "T12:00:00Z", reverses_transaction_id: null, metadata: {}, ...extra };
}
const charge = (id, jobId, amount, day) => entry(id, jobId, "charge", amount, day);
const payment = (id, jobId, amount, receipt, day, extra = {}) => entry(id, jobId, "payment", amount, day, { source_payment_id: receipt, metadata: { payment_id: receipt }, ...extra });
const reversal = (id, original, amount, jobId, receipt, day = "2026-11-02") => entry(id, jobId, "reversal", amount, day, { reverses_transaction_id: original, metadata: { reason: "payment_edit_or_removal", payment_id: receipt } });
const replacement = (id, jobId, amount, receipt, day = "2026-11-02") => payment(id, jobId, amount, receipt, day, { source_payment_id: null, metadata: { reason: "payment_edit", payment_id: receipt } });
const fixtures = [
  { name: "one sale with several receipts", jobs: [job("j",100,50)], rows: [charge("s","j",10000),payment("p1","j",2000,"receipt1"),payment("p2","j",3000,"receipt2")], totals: [10000,5000,5000] },
  { name: "repeated receipt corrections", jobs: [job("j",100,15)], rows: [
    charge("s","j",10000),payment("p","j",2000,"receipt",undefined,{metadata:{}}),
    reversal("r1","p",2000,"j","receipt"),replacement("p2","j",1000,"receipt"),
    reversal("r2","p2",1000,"j","receipt","2026-11-03"),replacement("p3","j",1500,"receipt","2026-11-03"),
  ], totals: [10000,1500,8500] },
  { name: "receipt removal without replacement", jobs: [job("j",100,0)], rows: [charge("s","j",10000),payment("p","j",2000,"receipt"),reversal("r","p",2000,"j","receipt")], totals: [10000,0,10000] },
  { name: "edited sale", jobs: [job("j",150,20)], rows: [
    charge("s","j",10000),payment("p","j",2000,"receipt"),
    entry("rs","j","reversal",10000,"2026-11-02",{reverses_transaction_id:"s",metadata:{reason:"job_edit"}}),
    entry("s2","j","charge",15000,"2026-11-02",{metadata:{reason:"job_edit"}}),
  ], totals: [15000,2000,13000] },
  { name: "deleted sale keeps history", jobs: [], rows: [charge("s","deleted",10000),payment("p","deleted",2000,"receipt")], totals: [10000,2000,0] },
  { name: "unlinked receipt and correction", jobs: [], rows: [payment("p",null,2000,"receipt"),reversal("r","p",2000,null,"receipt"),replacement("p2",null,1000,"receipt")], totals: [0,1000,0] },
  { name: "same customer with different jobs", jobs: [job("a",100,20),job("b",50,10)], rows: [charge("sa","a",10000),charge("sb","b",5000),payment("pa","a",2000,"a"),payment("pb","b",1000,"b")], totals: [15000,3000,12000] },
  { name: "receipt period excludes sale date", jobs: [job("j",100,25)], rows: [charge("s","j",10000,"2026-10-01"),payment("p","j",2500,"receipt","2026-11-03")], filter: {from:"2026-11-01",to:"2026-11-30"}, totals: [0,2500,7500] },
  { name: "correction reversal and replacement cross period boundary", jobs: [job("j",100,10)], rows: [charge("s","j",10000,"2026-10-01"),payment("p","j",2000,"receipt","2026-10-02"),reversal("r","p",2000,"j","receipt"),replacement("p2","j",1000,"receipt")], filter:{from:"2026-11-01",to:"2026-11-30"}, totals:[0,-1000,9000] },
  { name: "exact paise receipts and corrections", jobs: [job("j",.03,.01)], rows: [charge("s","j",3),payment("p","j",2,"receipt"),reversal("r","p",2,"j","receipt"),replacement("p2","j",1,"receipt")], totals: [3,1,2] },
  { name: "unclassified events stay in explicit fallback groups", jobs: [job("j",100,20)], rows: [charge("s","j",10000),payment("p","j",2000,"receipt"),entry("adj","j","adjustment",50),entry("opening",null,"opening_balance",20)], totals: [10000,2000,8000] },
];
function freeze(value) {
  if (value && typeof value === "object" && !Object.isFrozen(value)) { Object.freeze(value); Object.values(value).forEach(freeze); }
  return value;
}
function project(fixture, extra = {}) {
  const snapshot = {owner:"Owner",business:"Test",jobs:fixture.jobs,payments:[]};
  const report = flat.ledgerReport(fixture.rows, owner, snapshot);
  const filter = {...flat.defaultReportFilter,...fixture.filter,...extra};
  const view = flat.selectReport(report,filter);
  const csv = flat.reportCsv(view.rows);
  freeze(report); freeze(snapshot); freeze(fixture.rows); freeze(view.rows);
  const groups = groupReportRows(owner,report,snapshot,view.rows,filter,fixture.rows);
  return {snapshot,report,filter,view,csv,groups};
}
for (const fixture of fixtures) {
  test(fixture.name + ": grouped projection preserves every event, summary and CSV byte", () => {
    const {report,filter,view,csv,groups} = project(fixture);
    assert.deepEqual([view.sales,view.payments,report.activeOutstandingPaise],fixture.totals);
    const events = Array.from(groups).flatMap(group=>Array.from(group.events,event=>event.row));
    assert.equal(new Set(events.map(row=>row.id)).size,events.length);
    assert.deepEqual(events.map(row=>row.id).sort(),Array.from(report.rows,row=>row.id).sort());
    const groupedAccounting = flat.selectReport({...report,rows:events},filter);
    assert.equal(groupedAccounting.sales,view.sales);
    assert.equal(groupedAccounting.payments,view.payments);
    const groupedOutstanding = groups.filter(group=>group.job).reduce((sum,group)=>sum+Math.max(0,group.lifetime.bakiPaise),0);
    assert.equal(groupedOutstanding,report.activeOutstandingPaise);
    assert.equal(Buffer.compare(Buffer.from(csv),Buffer.from(flat.reportCsv(view.rows))),0);
    assert.equal(flat.reportCsv(groupedAccounting.rows),csv);

    for (const kind of ["all","charge","payment","correction","reversal","adjustment","opening_balance"]) {
      const selected = project(fixture,{kind,search:"Ash"});
      assert.deepEqual([selected.view.sales,selected.view.payments,selected.report.activeOutstandingPaise],fixture.totals);
      assert.deepEqual(Array.from(selected.groups).flatMap(group=>Array.from(group.matches,row=>row.id)).sort(),Array.from(selected.view.rows,row=>row.id).sort());
      assert.ok(selected.groups.every(group=>group.matches.length>0));
      const after = flat.selectReport(selected.report,selected.filter);
      assert.equal(Buffer.compare(Buffer.from(selected.csv),Buffer.from(flat.reportCsv(after.rows))),0);
    }
  });
}

test("repeated corrections follow their original receipt, not other receipts from the same customer", () => {
  const {groups} = project(fixtures[1]);
  assert.equal(groups.length,1);
  assert.equal(groups[0].receipts.length,1);
  assert.deepEqual(Array.from(groups[0].receipts[0].events,event=>event.row.id),["p","r1","p2","r2","p3"]);
  assert.equal(groups[0].receipts[0].netPaise,1500);
  assert.equal(project(fixtures[0]).groups[0].receipts.length,2);
  assert.equal(project(fixtures[2]).groups[0].receipts[0].netPaise,0);
});

test("identity is owner/job scoped and historical and unclassified groups remain visible", () => {
  const {groups} = project(fixtures[6]);
  assert.equal(groups.length,2);
  assert.deepEqual(Array.from(groups,group=>group.jobId).sort(),["a","b"]);
  assert.equal(project(fixtures[4]).groups[0].label,"Historical / deleted sale");
  assert.equal(project(fixtures[5]).groups[0].label,"Unlinked receipt / event");
  assert.equal(project(fixtures[10]).groups.filter(group=>group.label==="Unclassified event").length,2);
  const data=project(fixtures[0]);
  assert.throws(()=>groupReportRows("other-owner",data.report,data.snapshot,data.view.rows,data.filter,fixtures[0].rows),/another account/);
});

test("receipt remains visible when its sale is outside the selected period", () => {
  const {groups}=project(fixtures[7]);
  assert.equal(groups.length,1);
  assert.equal(groups[0].lifetime.totalPaise,10000);
  assert.equal(groups[0].period.salesPaise,0);
  assert.equal(groups[0].period.receivedPaise,2500);
  assert.equal(groups[0].sales[0].inPeriod,false);
  assert.equal(groups[0].sales[0].matches,false);
  assert.equal(groups[0].receipts[0].events[0].matches,true);
});

test("missing receipt correlation never guesses by amount or customer name", () => {
  const data={jobs:[job("j",100,40)],rows:[charge("s","j",10000),
    payment("p1","j",2000,null,undefined,{metadata:{}}),
    payment("p2","j",2000,null,undefined,{metadata:{}})]};
  assert.equal(project(data).groups[0].receipts.length,2);
});

test("legacy snapshot grouping and whole-word search use the same flat selection", () => {
  const snapshot={owner:"Owner",business:"Test",jobs:[job("a",100,20),job("b",50,0,"Basha")],payments:[{id:"p",jobId:"a",customer:"Asha",amount:20,date:"2026-11-03",createdAt:"2026-11-03T00:00:00Z"}]};
  const report=flat.legacyReport(snapshot);
  const filter={...flat.defaultReportFilter,search:"Asha",kind:"payment"};
  const view=flat.selectReport(report,filter),before=flat.reportCsv(view.rows);
  const groups=groupReportRows(owner,report,snapshot,view.rows,filter);
  assert.equal(groups.length,1);
  assert.equal(groups[0].jobId,"a");
  assert.equal(groups[0].receipts.length,1);
  assert.equal(groups[0].lifetime.receivedPaise,2000);
  assert.equal(flat.reportCsv(view.rows),before);
  assert.equal(view.sales,15000);
  assert.equal(view.payments,2000);
  assert.equal(report.activeOutstandingPaise,13000);
});

test("screen grouping never supplies the flat summary, CSV or print inputs", () => {
  const source=fs.readFileSync(path.join(__dirname,"../app/reports.tsx"),"utf8");
  assert.ok(source.includes("new Blob([reportCsv(matchingRows)]"));
  assert.ok(source.includes("sales and other groups ({matchingRows.length} matching transactions)"));
  assert.ok(source.includes('["Total Sales", view.sales]'));
  assert.ok(source.includes('["Payments Received", view.payments]'));
  assert.ok(source.includes('["Overall Outstanding", report.activeOutstandingPaise]'));
  assert.ok(source.includes("rows={matchingRows} summary={{ sales: view.sales"));
  const ui=fs.readFileSync(path.join(__dirname,"../app/reports-groups.tsx"),"utf8");
  for(const text of ["Lifetime total","Received so far","Lifetime baki","selected period","Context only","View read-only"]) assert.ok(ui.includes(text),text);
  assert.ok(!/fetch\(|<input|<select/.test(ui));
});
const React = require("react");
const { renderToStaticMarkup } = require("react-dom/server");
function groupedMarkup(groups) {
  const source = fs.readFileSync(path.join(__dirname, "../app/reports-groups.tsx"), "utf8");
  const output = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX } }).outputText;
  const exports = {};
  vm.runInNewContext(output, { exports, require: name => {
    if (name === "react/jsx-runtime") return require(name);
    if (name === "@/lib/reports") return flat;
    if (name === "@/lib/reports-ui") return load("reports-ui");
    throw new Error("Unexpected import " + name);
  } });
  return renderToStaticMarkup(React.createElement(exports.default, { groups, total: groups.length, onSelect() {} }));
}

test("rendered sale rows expose receipt chains, lifetime/period labels and read-only actions", () => {
  const markup = groupedMarkup(project(fixtures[1]).groups);
  assert.ok(!markup.includes(" ? "));
  assert.equal((markup.match(/class="reports-sale-group"/g)||[]).length,1);
  assert.equal((markup.match(/class="reports-receipt-chain"/g)||[]).length,1);
  for(const text of ["Lifetime total","Received so far","Lifetime baki","selected period","Reversal","Replacement","View transaction","read-only sale"]) assert.ok(markup.includes(text),text);
  const filtered = groupedMarkup(project(fixtures[7]).groups);
  assert.ok(filtered.includes("Context only - outside current filters"));
  assert.ok(!/<input|<select|>Edit<|>Delete</.test(markup));
  assert.ok(groupedMarkup(project(fixtures[4]).groups).includes("Historical / deleted sale"));
  assert.ok(groupedMarkup(project(fixtures[5]).groups).includes("Unlinked receipt / event"));
  assert.ok(groupedMarkup(project(fixtures[10]).groups).includes("Unclassified event"));
});
