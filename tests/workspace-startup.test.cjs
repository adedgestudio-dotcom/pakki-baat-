/* eslint-disable @typescript-eslint/no-require-imports */
const test = require("node:test"), assert = require("node:assert/strict"), fs = require("node:fs"), path = require("node:path"), ts = require("typescript"), vm = require("node:vm");
const compile = file => ts.transpileModule(fs.readFileSync(path.join(__dirname, file), "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
const owner = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const snapshot = name => ({ jobs: [{ id: "job", customer: name, work: "Repair", total: 10, paid: 0, date: "2026-10-10", time: "", status: "Confirmed", source: "test" }], owner: "Owner", business: "Shop", reminders: [], payments: [], notes: [], customerPhones: {} });
const isSnapshot = value => Boolean(value && typeof value === "object" && Array.isArray(value.jobs) && typeof value.owner === "string" && typeof value.business === "string");
const pendingKey = `pakki-baat-workspace-pending:${owner}`;
const journal = (value, extra = {}) => ({ version: 1, ownerId: owner, baseRevision: 4, syncStrategy: "revisioned", operationId: "cccccccc-cccc-4ccc-8ccc-cccccccccccc", createdAt: "2026-10-10T12:00:00.000Z", snapshot: value, ...extra });
function storage(values = new Map()) { return { values, getItem: key => values.get(key) ?? null, setItem: (key, value) => values.set(key, value), removeItem: key => values.delete(key) }; }
function api() {
  const data = { isSnapshot }, journalModule = { exports: {} }, reconciliation = { exports: {} }, startup = { exports: {} };
  vm.runInNewContext(compile("../lib/workspace-journal.ts"), { module: journalModule, exports: journalModule.exports, require: n => { if (n === "./data") return data; throw new Error(n); }, JSON, Date, localStorage: undefined });
  vm.runInNewContext(compile("../lib/workspace-reconciliation.ts"), { module: reconciliation, exports: reconciliation.exports, require: n => { if (n === "./data") return data; if (n === "./workspace-journal") return journalModule.exports; throw new Error(n); }, JSON });
  vm.runInNewContext(compile("../lib/workspace-startup.ts"), { module: startup, exports: startup.exports, require: n => { if (n === "./workspace-journal") return journalModule.exports; if (n === "./workspace-reconciliation") return reconciliation.exports; throw new Error(n); }, JSON });
  return startup.exports;
}
const cloud = (extra = {}) => ({ available: true, ownerId: owner, snapshot: snapshot("Cloud"), revision: 4, ledgerEnabled: true, ...extra });
const startup = (extra = {}) => api().reconcileWorkspaceStartup({ ownerId: owner, localSnapshot: snapshot("Local"), ledgerDirty: null, cloud: cloud(), storage: storage(), ...extra });

test("startup gives an owner-scoped pending journal precedence over older cloud", () => {
  const s = storage(new Map([[pendingKey, JSON.stringify(journal(snapshot("Pending")))]]));
  const result = startup({ storage: s });
  assert.equal(result.state, "journal-pending");
  assert.equal(result.displaySnapshot.jobs[0].customer, "Pending");
});
test("matching cloud makes a journal an acknowledgment candidate", () => {
  const value = snapshot("Cloud"), result = startup({ storage: storage(new Map([[pendingKey, JSON.stringify(journal(value))]])), cloud: cloud({ snapshot: value }) });
  assert.equal(result.state, "journal-acknowledged");
  assert.equal(result.acknowledgmentCandidate.operationId, "cccccccc-cccc-4ccc-8ccc-cccccccccccc");
});
test("advanced revision, invalid journal, and ledger disagreement block startup writes", () => {
  const advanced = startup({ storage: storage(new Map([[pendingKey, JSON.stringify(journal(snapshot("Pending")))]])), cloud: cloud({ revision: 5 }) });
  const invalid = startup({ storage: storage(new Map([[pendingKey, "bad-journal"]])) });
  const disagreement = startup({ storage: storage(new Map([[pendingKey, JSON.stringify(journal(snapshot("Pending")))]])), ledgerDirty: { snapshot: snapshot("Dirty"), revision: 4 } });
  assert.equal(advanced.state, "recovery-conflict"); assert.equal(invalid.state, "recovery-conflict"); assert.equal(disagreement.state, "recovery-conflict");
});
test("manual journals and cloud unavailability preserve local recovery without auto-upload", () => {
  const manual = startup({ storage: storage(new Map([[pendingKey, JSON.stringify(journal(snapshot("Manual"), { baseRevision: null, syncStrategy: "manual" }))]])) });
  const unavailable = startup({ storage: storage(new Map([[pendingKey, JSON.stringify(journal(snapshot("Offline")))]])), cloud: cloud({ available: false, ownerId: null, snapshot: null, revision: null }) });
  assert.equal(manual.state, "journal-manual-recovery"); assert.equal(manual.automaticUploadAllowed, false);
  assert.equal(unavailable.state, "cloud-unavailable-local-pending"); assert.equal(unavailable.automaticUploadAllowed, false);
});
test("cloud identity change is a recovery conflict", () => {
  const result = startup({ cloud: cloud({ ownerId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb" }) });
  assert.equal(result.state, "recovery-conflict");
});
