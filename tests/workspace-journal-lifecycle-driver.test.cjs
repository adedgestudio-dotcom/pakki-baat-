/* eslint-disable @typescript-eslint/no-require-imports */
const test = require("node:test"), assert = require("node:assert/strict"), fs = require("node:fs"), path = require("node:path"), ts = require("typescript"), vm = require("node:vm");
const root = path.join(__dirname, "..");
const compile = name => ts.transpileModule(fs.readFileSync(path.join(root, "lib", name), "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
function api() {
  const mod = { exports: {} };
  class Coordinator { constructor(deps) { this.deps = deps; } upload(request) { return this.deps.upload(request); } acknowledgmentForExactLocalConfirmation(journal, revision) { return { ownerId: journal.ownerId, operationId: journal.operationId, snapshot: journal.snapshot, revision }; } }
  vm.runInNewContext(compile("workspace-journal-lifecycle-driver.ts"), { module: mod, exports: mod.exports, require: name => {
    if (name === "./workspace-journal-coordinator") return { WorkspaceJournalCoordinator: Coordinator };
    if (name === "./workspace-journal") return { isPendingWorkspaceJournal: value => Boolean(value && value.ownerId && value.operationId && value.snapshot) };
    return {};
  }, JSON, Promise, Map, Set, Number });
  return mod.exports;
}
const owner = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", other = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const snapshot = value => ({ jobs: [{ id: value, customer: "Asha", total: 10, paid: 0 }], payments: [], reminders: [], notes: [], customerPhones: {}, owner: "Asha", business: "Shop" });
const journal = (value = "one", operationId = "cccccccc-cccc-4ccc-8ccc-cccccccccccc") => ({ version: 1, ownerId: owner, baseRevision: 4, syncStrategy: "revisioned", operationId, createdAt: "2026-10-13T00:00:00.000Z", snapshot: snapshot(value) });
function harness(extra = {}) {
  let active = owner, current = journal(), selection = { source: "guarded-signed-in", ownerId: owner }, calls = 0, localAcks = 0;
  const tasks = [], acknowledgments = [], acknowledgmentContexts = [], backups = [];
  const deps = {
    activeOwnerId: async () => active,
    isOnline: () => true,
    readCurrentJournal: () => current,
    acknowledgeExactLocalJournal: (_owner, pending) => { if (JSON.stringify(pending) !== JSON.stringify(current)) throw new Error("stale"); localAcks += 1; current = null; },
    sourceSelection: () => selection,
    schedule: (task, context) => tasks.push({ task, context }),
    onAcknowledged: (ack, context) => { acknowledgments.push(ack); acknowledgmentContexts.push(context); },
    upload: async request => { calls += 1; current = null; return { status: "acknowledged", acknowledgment: { ownerId: request.ownerId, operationId: request.operationId, snapshot: request.snapshot, revision: 5 } }; },
    postAcknowledgmentBackup: async ack => { backups.push(ack); },
    ...extra,
  };
  return { api: api(), deps, tasks, acknowledgments, acknowledgmentContexts, backups, state: { get active() { return active; }, set active(value) { active = value; }, get current() { return current; }, set current(value) { current = value; }, get selection() { return selection; }, set selection(value) { selection = value; }, get calls() { return calls; }, get localAcks() { return localAcks; } } };
}
async function runNext(h) { const item = h.tasks.shift(); assert.ok(item, "expected scheduled lifecycle task"); await item.task(); return item.context; }

test("durable journal schedules one exact guarded upload and acknowledgement", async () => {
  const h = harness(), driver = new h.api.WorkspaceJournalLifecycleDriver(h.deps), pending = journal();
  assert.equal((await driver.onDurableJournal(pending, pending.snapshot)).scheduled, true);
  assert.equal((await driver.onDurableJournal(pending, pending.snapshot)).scheduled, false);
  const context = await runNext(h);
  assert.equal(context.reason, "durable-journal"); assert.equal(h.state.calls, 1); assert.equal(h.acknowledgments.length, 1); assert.equal(h.acknowledgments[0].operationId, pending.operationId);
  assert.equal(h.acknowledgmentContexts[0].journal, pending); assert.equal(h.acknowledgmentContexts[0].generation, 0);
});

test("offline and ambiguous results retry the same stored operation, including after reconnect", async () => {
  const outcomes = ["offline", "ambiguous", "acknowledged"];
  const h = harness({ upload: async request => { const status = outcomes.shift(); if (status !== "acknowledged") return { status, reason: status }; h.state.current = null; return { status, acknowledgment: { ownerId: owner, operationId: request.operationId, snapshot: request.snapshot, revision: 5 } }; } });
  const driver = new h.api.WorkspaceJournalLifecycleDriver(h.deps), pending = journal();
  await driver.onDurableJournal(pending, pending.snapshot); await runNext(h);
  assert.equal(h.tasks[0].context.reason, "retry"); assert.equal(h.tasks[0].context.operationId, pending.operationId);
  assert.equal((await driver.onConnectivityRestored()).scheduled, false, "existing retry is deduplicated");
  await runNext(h); await runNext(h);
  assert.equal(h.acknowledgments.length, 1); assert.equal(h.acknowledgments[0].operationId, pending.operationId);
});

test("startup pending uploads, while startup acknowledged performs local exact acknowledgement without upload", async () => {
  const pending = journal(), recovery = { state: "journal-pending", displaySnapshot: pending.snapshot, acknowledgmentCandidate: null, preserve: {}, reason: "pending" };
  const h = harness(), driver = new h.api.WorkspaceJournalLifecycleDriver(h.deps);
  assert.equal((await driver.onStartupRecovery({ ownerId: owner, confirmedRevision: 4, reconciliation: recovery })).scheduled, true); await runNext(h); assert.equal(h.state.calls, 1);
  const acknowledged = { ...recovery, state: "journal-acknowledged", acknowledgmentCandidate: pending, displaySnapshot: pending.snapshot };
  const h2 = harness(), driver2 = new h2.api.WorkspaceJournalLifecycleDriver(h2.deps);
  assert.equal((await driver2.onStartupRecovery({ ownerId: owner, confirmedRevision: 7, reconciliation: acknowledged })).scheduled, true); await runNext(h2);
  assert.equal(h2.state.calls, 0); assert.equal(h2.state.localAcks, 1); assert.equal(h2.acknowledgments[0].revision, 7);
});

test("manual and conflict startup states fail closed without scheduling", async () => {
  const h = harness(), driver = new h.api.WorkspaceJournalLifecycleDriver(h.deps), pending = journal();
  const manual = { state: "journal-manual-recovery", displaySnapshot: pending.snapshot, acknowledgmentCandidate: null, preserve: {}, reason: "manual" };
  const conflict = { ...manual, state: "recovery-conflict" };
  assert.equal((await driver.onStartupRecovery({ ownerId: owner, confirmedRevision: null, reconciliation: manual })).scheduled, false);
  assert.equal((await driver.onStartupRecovery({ ownerId: owner, confirmedRevision: null, reconciliation: conflict })).scheduled, false);
  assert.equal(h.tasks.length, 0);
});

test("account switch and disposal ignore stale asynchronous completion while retaining journals", async () => {
  let release;
  const h = harness({ upload: request => new Promise(resolve => { release = () => { h.state.current = null; resolve({ status: "acknowledged", acknowledgment: { ownerId: owner, operationId: request.operationId, snapshot: request.snapshot, revision: 5 } }); }; }) });
  const driver = new h.api.WorkspaceJournalLifecycleDriver(h.deps), pending = journal();
  await driver.onDurableJournal(pending, pending.snapshot); const running = runNext(h); await new Promise(resolve => setImmediate(resolve));
  h.state.active = other; h.state.selection = { source: "guarded-signed-in", ownerId: other }; driver.onOwnerChanged(other); release(); await running;
  assert.equal(h.acknowledgments.length, 0);
  const h2 = harness({ upload: request => new Promise(resolve => { release = () => { h2.state.current = null; resolve({ status: "acknowledged", acknowledgment: { ownerId: owner, operationId: request.operationId, snapshot: request.snapshot, revision: 5 } }); }; }) });
  const driver2 = new h2.api.WorkspaceJournalLifecycleDriver(h2.deps); await driver2.onDurableJournal(pending, pending.snapshot); const disposed = runNext(h2); await new Promise(resolve => setImmediate(resolve)); driver2.dispose(); release(); await disposed;
  assert.equal(h2.acknowledgments.length, 0);
});

test("optional post-ack backup failure does not undo an exact acknowledgment and the module remains unconnected", async () => {
  const h = harness({ postAcknowledgmentBackup: async () => { throw new Error("backup unavailable"); } }), driver = new h.api.WorkspaceJournalLifecycleDriver(h.deps), pending = journal();
  await driver.onDurableJournal(pending, pending.snapshot); await runNext(h);
  assert.equal(h.acknowledgments.length, 1);
  const workspace = fs.readFileSync(path.join(root, "app/workspace.tsx"), "utf8");
  assert.doesNotMatch(workspace, /workspace-journal-lifecycle-driver/);
});
