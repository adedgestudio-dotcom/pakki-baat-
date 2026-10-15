/* eslint-disable @typescript-eslint/no-require-imports */
const test = require("node:test"), assert = require("node:assert/strict"), fs = require("node:fs"), path = require("node:path"), ts = require("typescript"), vm = require("node:vm");
const root = path.join(__dirname, "..");
const owner = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", other = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const operationId = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const snapshot = name => ({ jobs: [], payments: [], reminders: [], notes: [], customerPhones: {}, owner: name, business: "Shop" });
const same = (left, right) => JSON.stringify(left) === JSON.stringify(right);
const compile = name => ts.transpileModule(fs.readFileSync(path.join(root, "lib", name), "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;

function api() {
  const trusted = new WeakSet(), recovery = { current: null, fail: false };
  const journal = { exports: {} }, reducer = { exports: {} }, coordinator = { exports: {} }, boundary = { exports: {} };
  const run = (target, name, require) => vm.runInNewContext(compile(name), { module: target, exports: target.exports, require, JSON, Date, Set, WeakSet, localStorage: undefined });
  run(journal, "workspace-journal.ts", name => name === "./data" ? { isSnapshot: value => Boolean(value && Array.isArray(value.jobs) && Array.isArray(value.payments) && typeof value.owner === "string" && typeof value.business === "string") } : {});
  run(reducer, "workspace-guarded-reducer.ts", name => ({ "./workspace-journal": journal.exports })[name] || {});
  const handoff = (state, acknowledgment) => state.ownerId === acknowledgment.ownerId && state.latestOperationId === acknowledgment.operationId && state.recovery === "pending" && same(state.snapshot, acknowledgment.snapshot) && Number.isSafeInteger(acknowledgment.revision) && acknowledgment.revision >= 1
    ? { ...state, recovery: "clear", journalStatus: "cloud-confirmed", recoveryReason: `Workspace journal was confirmed at cloud revision ${acknowledgment.revision}.` }
    : state;
  coordinator.exports = {
    isTrustedJournalCloudAcknowledgment: value => Boolean(value && typeof value === "object" && trusted.has(value)),
    applyJournalCloudAcknowledgment: handoff,
  };
  run(boundary, "workspace-snapshot-boundary.ts", name => ({
    react: { useCallback: fn => fn, useReducer: () => [0, () => {}], useRef: () => ({ current: null }) },
    "./data": { isSnapshot: value => Boolean(value && Array.isArray(value.jobs) && Array.isArray(value.payments) && typeof value.owner === "string" && typeof value.business === "string") },
    "./workspace-guarded-reducer": reducer.exports,
    "./workspace-journal": { ...journal.exports, readWorkspaceRecovery: () => { if (recovery.fail) throw new Error("storage unavailable"); return recovery.current || { source: "none" }; } },
    "./workspace-journal-coordinator": coordinator.exports,
  })[name] || {});
  const makeJournal = (value = snapshot("Asha"), id = operationId, baseRevision = 4) => ({ version: 1, ownerId: owner, baseRevision, syncStrategy: "revisioned", operationId: id, createdAt: "2026-10-13T00:00:00.000Z", snapshot: value });
  const mint = (journalValue, revision = 5) => { const value = Object.freeze({ ownerId: journalValue.ownerId, operationId: journalValue.operationId, snapshot: journalValue.snapshot, revision }); trusted.add(value); return value; };
  const pendingBoundary = (journalValue = makeJournal()) => {
    const value = new boundary.exports.WorkspaceSnapshotBoundary();
    value.state = { ownerId: owner, snapshot: journalValue.snapshot, latestOperationId: journalValue.operationId, recovery: "pending", journalStatus: "journal-pending", recoveryReason: "pending" };
    recovery.current = { source: "local", snapshot: journalValue.snapshot };
    return value;
  };
  return { boundary: boundary.exports, recovery, makeJournal, mint, pendingBoundary };
}

function request(journal, acknowledgment, extra = {}) {
  return { activeOwnerId: owner, sessionOwnerId: owner, journal, acknowledgment, ...extra };
}

test("exact trusted acknowledgment clears only the latest pending state and notifies once", () => {
  const a = api(), journal = a.makeJournal(), boundary = a.pendingBoundary(journal), acknowledgment = a.mint(journal);
  let notifications = 0;
  const unsubscribe = boundary.subscribe(() => { notifications += 1; });
  const result = boundary.applyCloudAcknowledgment(request(journal, acknowledgment));
  assert.equal(result.accepted, true); assert.equal(boundary.getState().recovery, "clear"); assert.equal(boundary.getState().journalStatus, "cloud-confirmed");
  assert.equal(boundary.getRevision(), 1); assert.equal(notifications, 1);
  assert.equal(boundary.applyCloudAcknowledgment(request(journal, acknowledgment)).accepted, false);
  assert.equal(boundary.getRevision(), 1); assert.equal(notifications, 1); unsubscribe();
});

test("fabricated, wrong-owner, wrong-session, stale and wrong-snapshot acknowledgments preserve pending recovery", () => {
  const a = api(), journal = a.makeJournal(), boundary = a.pendingBoundary(journal), trusted = a.mint(journal), before = boundary.getState();
  assert.equal(boundary.applyCloudAcknowledgment(request(journal, { ...trusted })).accepted, false);
  assert.equal(boundary.applyCloudAcknowledgment(request(journal, trusted, { activeOwnerId: other })).accepted, false);
  assert.equal(boundary.applyCloudAcknowledgment(request(journal, trusted, { sessionOwnerId: other })).accepted, false);
  const staleJournal = a.makeJournal(journal.snapshot, "dddddddd-dddd-4ddd-8ddd-dddddddddddd");
  assert.equal(boundary.applyCloudAcknowledgment(request(staleJournal, a.mint(staleJournal))).accepted, false);
  const wrongSnapshotJournal = a.makeJournal(snapshot("Different"));
  assert.equal(boundary.applyCloudAcknowledgment(request(wrongSnapshotJournal, a.mint(wrongSnapshotJournal))).accepted, false);
  assert.deepEqual(boundary.getState(), before);
});

test("revision mismatch, retained journal, and storage failure reject without changing boundary state", () => {
  const a = api(), journal = a.makeJournal(), boundary = a.pendingBoundary(journal), before = boundary.getState();
  assert.equal(boundary.applyCloudAcknowledgment(request(journal, a.mint(journal, 3))).accepted, false);
  a.recovery.current = { source: "pending", snapshot: journal.snapshot, journal };
  assert.equal(boundary.applyCloudAcknowledgment(request(journal, a.mint(journal))).accepted, false);
  a.recovery.current = { source: "none" };
  assert.equal(boundary.applyCloudAcknowledgment(request(journal, a.mint(journal))).accepted, false);
  a.recovery.current = { source: "local", snapshot: journal.snapshot }; a.recovery.fail = true;
  assert.equal(boundary.applyCloudAcknowledgment(request(journal, a.mint(journal))).accepted, false);
  assert.deepEqual(boundary.getState(), before);
});

test("account switch during asynchronous work leaves the old pending snapshot untouched", () => {
  const a = api(), journal = a.makeJournal(), boundary = a.pendingBoundary(journal), acknowledgment = a.mint(journal), before = boundary.getState();
  boundary.state = { ...boundary.state, ownerId: other };
  assert.equal(boundary.applyCloudAcknowledgment(request(journal, acknowledgment)).accepted, false);
  assert.equal(boundary.getState().ownerId, other); assert.equal(boundary.getState().recovery, before.recovery);
});
