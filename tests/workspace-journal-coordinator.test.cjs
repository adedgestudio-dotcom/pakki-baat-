/* eslint-disable @typescript-eslint/no-require-imports */
const test = require("node:test"), assert = require("node:assert/strict"), fs = require("node:fs"), path = require("node:path"), ts = require("typescript"), vm = require("node:vm");
const root = path.join(__dirname, "..");
const compile = name => ts.transpileModule(fs.readFileSync(path.join(root, "lib", name), "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
function api() {
  const mod = { exports: {} };
  vm.runInNewContext(compile("workspace-journal-coordinator.ts"), { module: mod, exports: mod.exports, require: name => {
    if (name === "./workspace-journal") return { isPendingWorkspaceJournal: value => Boolean(value && value.ownerId && value.operationId && value.snapshot) };
    if (name === "./workspace-guarded-reducer") return { guardedWorkspaceReducer: (state, action) => action.type === "apply-cloud-acknowledgment" && state.ownerId === action.ownerId && state.latestOperationId === action.operationId && JSON.stringify(state.snapshot) === JSON.stringify(action.snapshot) ? { ...state, recovery: "clear", journalStatus: "cloud-confirmed", recoveryReason: `Workspace journal was confirmed at cloud revision ${action.revision}.` } : state };
    return {};
  }, JSON, Promise, Map, Set });
  return mod.exports;
}
const owner = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", other = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const snapshot = value => ({ jobs: [{ id: value, customer: "Asha", total: 10, paid: 0 }], payments: [], reminders: [], notes: [], customerPhones: {}, owner: "Asha", business: "Shop" });
const journal = (value = "one", operationId = "cccccccc-cccc-4ccc-8ccc-cccccccccccc") => ({ version: 1, ownerId: owner, baseRevision: 4, syncStrategy: "revisioned", operationId, createdAt: "2026-10-13T00:00:00.000Z", snapshot: snapshot(value) });
function harness(extra = {}) {
  let active = owner, online = true, current = journal(), calls = 0, acknowledgments = 0;
  const transport = async value => { calls += 1; return { status: "cloud-acknowledged", acknowledgment: { ownerId: owner, snapshot: value.snapshot, revision: 5 } }; };
  const deps = {
    activeOwnerId: async () => active,
    isOnline: () => online,
    readCurrentJournal: () => current,
    acknowledgeExactLocalJournal: (_owner, value) => { if (JSON.stringify(value) !== JSON.stringify(current)) throw new Error("newer journal"); acknowledgments += 1; current = null; },
    transport,
    ...extra,
  };
  return { api: api(), deps, state: { get active() { return active; }, set active(value) { active = value; }, get online() { return online; }, set online(value) { online = value; }, get current() { return current; }, set current(value) { current = value; }, get calls() { return calls; }, get acknowledgments() { return acknowledgments; } } };
}
const request = value => { const pending = journal(value); return { ownerId: owner, operationId: pending.operationId, snapshot: pending.snapshot, journal: pending }; };

test("deduplicates concurrent uploads and returns exact owner, operation, snapshot, and revision", async () => {
  let release;
  const h = harness({ transport: value => new Promise(resolve => { release = () => resolve({ status: "cloud-acknowledged", acknowledgment: { ownerId: owner, snapshot: value.snapshot, revision: 5 } }); }) });
  const coordinator = new h.api.WorkspaceJournalCoordinator(h.deps), first = coordinator.upload(request("one")), second = coordinator.upload(request("one"));
  assert.equal(first, second); await new Promise(resolve => setImmediate(resolve)); release();
  const result = await first;
  assert.equal(result.status, "acknowledged");
  assert.equal(result.acknowledgment.ownerId, owner); assert.equal(result.acknowledgment.operationId, request("one").operationId); assert.equal(result.acknowledgment.revision, 5); assert.deepEqual(result.acknowledgment.snapshot, snapshot("one"));
  assert.equal(h.api.isTrustedJournalCloudAcknowledgment(result.acknowledgment), true);
  assert.equal(h.api.isTrustedJournalCloudAcknowledgment({ ...result.acknowledgment }), false);
  assert.equal(h.state.acknowledgments, 1);
});

test("offline and ambiguous outcomes preserve the journal and can retry after reconnect", async () => {
  let attempt = 0;
  const h = harness({ transport: async value => (++attempt === 1 ? { status: "ambiguous", reason: "response lost" } : { status: "cloud-acknowledged", acknowledgment: { ownerId: owner, snapshot: value.snapshot, revision: 5 } }) });
  const coordinator = new h.api.WorkspaceJournalCoordinator(h.deps);
  h.state.online = false;
  assert.equal((await coordinator.upload(request("one"))).status, "offline");
  h.state.online = true;
  assert.equal((await coordinator.upload(request("one"))).status, "ambiguous");
  assert.notEqual(h.state.current, null);
  assert.equal((await coordinator.upload(request("one"))).status, "acknowledged");
  assert.equal(attempt, 2);
});

test("stale journal, session switch, manual journal, and local acknowledgment failure fail closed", async () => {
  const newer = journal("newer", "dddddddd-dddd-4ddd-8ddd-dddddddddddd");
  const stale = harness({ transport: async value => { stale.state.current = newer; return { status: "cloud-acknowledged", acknowledgment: { ownerId: owner, snapshot: value.snapshot, revision: 5 } }; } });
  assert.equal((await new stale.api.WorkspaceJournalCoordinator(stale.deps).upload(request("one"))).status, "stale-operation");
  assert.equal(stale.state.acknowledgments, 0);
  let count = 0;
  const switched = harness({ activeOwnerId: async () => ++count === 1 ? owner : other });
  assert.equal((await new switched.api.WorkspaceJournalCoordinator(switched.deps).upload(request("one"))).status, "stale-owner");
  const manual = request("one"); manual.journal = { ...manual.journal, syncStrategy: "manual", baseRevision: null };
  const manualHarness = harness();
  assert.equal((await new manualHarness.api.WorkspaceJournalCoordinator(manualHarness.deps).upload(manual)).status, "manual");
  const failed = harness({ acknowledgeExactLocalJournal: () => { throw new Error("quota"); } });
  assert.equal((await new failed.api.WorkspaceJournalCoordinator(failed.deps).upload(request("one"))).status, "local-acknowledgment-failed");
});

test("pure reducer handoff accepts only the latest exact acknowledgment", () => {
  const a = api(), state = { ownerId: owner, latestOperationId: "cccccccc-cccc-4ccc-8ccc-cccccccccccc", snapshot: snapshot("one"), recovery: "pending", journalStatus: "journal-pending", recoveryReason: "pending" };
  const next = a.applyJournalCloudAcknowledgment(state, { ownerId: owner, operationId: state.latestOperationId, snapshot: snapshot("one"), revision: 5 });
  assert.equal(next.recovery, "clear"); assert.equal(next.journalStatus, "cloud-confirmed");
  assert.equal(a.applyJournalCloudAcknowledgment(state, { ownerId: owner, operationId: "dddddddd-dddd-4ddd-8ddd-dddddddddddd", snapshot: snapshot("one"), revision: 5 }), state);
});

test("workflow ordering requires backup before destructive journal work and daily backup only after acknowledgment", () => {
  const a = api();
  assert.deepEqual(Array.from(a.guardedWorkflowSteps("normal")), ["journal-durable", "cloud-exact-acknowledged"]);
  assert.deepEqual(Array.from(a.guardedWorkflowSteps("reminder")), ["journal-durable", "cloud-exact-acknowledged"]);
  assert.deepEqual(Array.from(a.guardedWorkflowSteps("destructive")), ["verified-backup-preflight", "journal-durable", "cloud-exact-acknowledged"]);
  assert.deepEqual(Array.from(a.guardedWorkflowSteps("daily-backup")), ["cloud-exact-acknowledged", "post-ack-daily-backup"]);
});

test("cloud exposes a journal-only transport and the live component remains unconnected", () => {
  const cloud = fs.readFileSync(path.join(root, "lib/cloud.ts"), "utf8"), workspace = fs.readFileSync(path.join(root, "app/workspace.tsx"), "utf8");
  assert.match(cloud, /export async function uploadRevisionedWorkspaceJournal/);
  assert.match(cloud, /const uploaded = await uploadRevisionedWorkspaceJournal/);
  assert.doesNotMatch(workspace, /workspace-journal-coordinator/);
});
