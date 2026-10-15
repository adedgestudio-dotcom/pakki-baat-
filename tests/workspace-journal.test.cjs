/* eslint-disable @typescript-eslint/no-require-imports */
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const ts = require("typescript");
const vm = require("node:vm");

const source = fs.readFileSync(path.join(__dirname, "../lib/workspace-journal.ts"), "utf8");
const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
const snapshot = (name = "Asha") => ({ jobs: [{ id: "job-1", customer: name, work: "Repair", total: 100, paid: 0, date: "2026-10-10", time: "", status: "Confirmed", source: "test" }], owner: "Owner", business: "Shop", reminders: [], payments: [], notes: [], customerPhones: {} });
const ownerA = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const ownerB = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const operationA = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const journal = (ownerId = ownerA, value = snapshot()) => ({ version: 1, ownerId, baseRevision: 4, syncStrategy: "revisioned", operationId: operationA, createdAt: "2026-10-10T12:00:00.000Z", snapshot: value });

function storage({ failOnSet = null } = {}) {
  const values = new Map(); let sets = 0;
  return {
    values,
    getItem: key => values.get(key) ?? null,
    setItem: (key, value) => { sets++; if (failOnSet === sets) throw new Error("quota"); values.set(key, value); },
    removeItem: key => values.delete(key),
  };
}

function api() {
  const module = { exports: {} };
  vm.runInNewContext(compiled, { module, exports: module.exports, require: name => {
    if (name === "./data") return { isSnapshot: value => Boolean(value && typeof value === "object" && Array.isArray(value.jobs) && typeof value.owner === "string" && typeof value.business === "string") };
    throw new Error("Unexpected import " + name);
  }, JSON, Date, localStorage: undefined });
  return module.exports;
}

test("commit writes an owner-scoped journal before the compatible workspace snapshot", () => {
  const h = storage(), a = api(), value = journal();
  a.commitPendingWorkspaceSnapshot(value, h);
  assert.deepEqual(JSON.parse(h.values.get(a.pendingWorkspaceJournalKey(ownerA))), value);
  assert.deepEqual(JSON.parse(h.values.get(a.localWorkspaceStorageKey(ownerA))), value.snapshot);
  assert.equal(a.readWorkspaceRecovery(ownerA, h).source, "pending");
});

test("invalid snapshots and journal metadata are rejected before any write", () => {
  const h = storage(), a = api(), value = journal(); value.baseRevision = -1;
  assert.throws(() => a.commitPendingWorkspaceSnapshot(value, h), /journal is invalid/);
  assert.equal(h.values.size, 0);
});

test("a failed journal write does not write a workspace snapshot", () => {
  const h = storage({ failOnSet: 1 }), a = api();
  assert.throws(() => a.commitPendingWorkspaceSnapshot(journal(), h), /pending workspace changes/);
  assert.equal(h.values.size, 0);
});

test("unavailable browser storage cannot return a successful commit", () => {
  const a = api();
  assert.throws(() => a.commitPendingWorkspaceSnapshot(journal()), /cannot safely save workspace changes/);
});

test("an interrupted second write retains the authoritative pending recovery copy", () => {
  const h = storage({ failOnSet: 2 }), a = api(), value = journal();
  assert.throws(() => a.commitPendingWorkspaceSnapshot(value, h), /recovery copy was retained/);
  assert.equal(JSON.stringify(a.readWorkspaceRecovery(ownerA, h)), JSON.stringify({ source: "pending", snapshot: value.snapshot, journal: value }));
  assert.equal(h.values.has(a.localWorkspaceStorageKey(ownerA)), false);
});

test("pending journals are owner-scoped and take precedence over an older local snapshot", () => {
  const h = storage(), a = api(), pending = journal(ownerA, snapshot("Pending"));
  h.values.set(a.localWorkspaceStorageKey(ownerA), JSON.stringify(snapshot("Older")));
  h.values.set(a.pendingWorkspaceJournalKey(ownerA), JSON.stringify(pending));
  h.values.set(a.pendingWorkspaceJournalKey(ownerB), JSON.stringify(journal(ownerB, snapshot("B"))));
  assert.equal(a.readWorkspaceRecovery(ownerA, h).snapshot.jobs[0].customer, "Pending");
  assert.equal(a.readWorkspaceRecovery(ownerB, h).snapshot.jobs[0].customer, "B");
});

test("corrupt pending data is retained for explicit recovery instead of being discarded", () => {
  const h = storage(), a = api();
  h.values.set(a.pendingWorkspaceJournalKey(ownerA), "not-json");
  h.values.set(a.localWorkspaceStorageKey(ownerA), JSON.stringify(snapshot()));
  assert.equal(a.readWorkspaceRecovery(ownerA, h).source, "invalid-pending");
  assert.equal(h.values.get(a.pendingWorkspaceJournalKey(ownerA)), "not-json");
});

test("conditional acknowledgment removes only the exact trusted journal", () => {
  const h = storage(), a = api(), value = journal();
  a.commitPendingWorkspaceSnapshot(value, h);
  assert.equal(a.acknowledgePendingWorkspaceJournal(ownerA, value, value.snapshot, h), true);
  assert.equal(h.values.has(a.pendingWorkspaceJournalKey(ownerA)), false);
});

test("stale or mismatched acknowledgment cannot clear a newer pending journal", () => {
  const h = storage(), a = api(), old = journal(), newer = { ...journal(), operationId: "dddddddd-dddd-4ddd-8ddd-dddddddddddd" };
  a.commitPendingWorkspaceSnapshot(newer, h);
  assert.throws(() => a.acknowledgePendingWorkspaceJournal(ownerA, old, old.snapshot, h), /changed before acknowledgment/);
  assert.deepEqual(JSON.parse(h.values.get(a.pendingWorkspaceJournalKey(ownerA))), newer);
});

test("acknowledgment reports storage deletion failures and retains the journal", () => {
  const h = storage(), a = api(), value = journal();
  a.commitPendingWorkspaceSnapshot(value, h);
  h.removeItem = () => { throw new Error("blocked"); };
  assert.throws(() => a.acknowledgePendingWorkspaceJournal(ownerA, value, value.snapshot, h), /Could not acknowledge/);
  assert.deepEqual(JSON.parse(h.values.get(a.pendingWorkspaceJournalKey(ownerA))), value);
});

test("rejected handoff restoration reinstates only its exact journal and never overwrites newer data", () => {
  const h = storage(), a = api(), value = journal();
  h.values.set(a.localWorkspaceStorageKey(ownerA), JSON.stringify(value.snapshot));
  assert.deepEqual(a.restoreExactPendingWorkspaceJournal(value, h), value);
  assert.deepEqual(JSON.parse(h.values.get(a.pendingWorkspaceJournalKey(ownerA))), value);
  const newer = { ...value, operationId: "dddddddd-dddd-4ddd-8ddd-dddddddddddd" };
  h.values.set(a.pendingWorkspaceJournalKey(ownerA), JSON.stringify(newer));
  assert.throws(() => a.restoreExactPendingWorkspaceJournal(value, h), /newer pending workspace journal/);
  assert.deepEqual(JSON.parse(h.values.get(a.pendingWorkspaceJournalKey(ownerA))), newer);
});
