/* eslint-disable @typescript-eslint/no-require-imports */
const test = require("node:test"), assert = require("node:assert/strict"), fs = require("node:fs"), path = require("node:path"), ts = require("typescript"), vm = require("node:vm");
const root = path.join(__dirname, "..");
const owner = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", other = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb", operationId = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const snapshot = () => ({ jobs: [], payments: [], reminders: [], notes: [], customerPhones: {}, owner: "Asha", business: "Shop" });
const compile = () => ts.transpileModule(fs.readFileSync(path.join(root, "lib/workspace-lifecycle-boundary-handoff.ts"), "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
function api() {
  const mod = { exports: {} }, restored = [], calls = [];
  vm.runInNewContext(compile(), { module: mod, exports: mod.exports, require: name => {
    if (name === "./workspace-journal") return { restoreExactPendingWorkspaceJournal: (journal, storage) => { if (storage.fail) throw new Error("quota"); restored.push(journal); } };
    return {};
  }, JSON, Promise, Map, Set });
  let active = owner, session = owner, selection = { source: "guarded-signed-in", ownerId: owner };
  const boundary = { result: { accepted: true }, applyCloudAcknowledgment: input => { calls.push(input); return boundary.result; } };
  const deps = { boundary, activeOwnerId: async () => active, sessionOwnerId: async () => session, sourceSelection: () => selection, storage: { fail: false } };
  const journal = { version: 1, ownerId: owner, baseRevision: 4, syncStrategy: "revisioned", operationId, createdAt: "2026-10-13T00:00:00.000Z", snapshot: snapshot() };
  const acknowledgment = Object.freeze({ ownerId: owner, operationId, snapshot: journal.snapshot, revision: 5 });
  return { api: mod.exports, deps, journal, acknowledgment, restored, calls, state: { set active(value) { active = value; }, set session(value) { session = value; }, set selection(value) { selection = value; } } };
}
const context = journal => ({ ownerId: owner, generation: 0, journal });

test("forwards the exact opaque acknowledgment once and applies no recovery on success", async () => {
  const h = api(), handoff = new h.api.WorkspaceLifecycleBoundaryAcknowledgmentHandoff(h.deps);
  assert.equal((await handoff.asLifecycleAcknowledgmentHandler()(h.acknowledgment, context(h.journal))).status, "applied");
  assert.equal(h.calls.length, 1); assert.equal(h.calls[0].acknowledgment, h.acknowledgment);
  assert.equal(h.calls[0].journal, h.journal); assert.equal(h.restored.length, 0);
  assert.equal((await handoff.apply(h.acknowledgment, context(h.journal))).status, "duplicate"); assert.equal(h.calls.length, 1);
});

test("boundary rejection restores only the original journal and reports recovery required", async () => {
  const h = api(), handoff = new h.api.WorkspaceLifecycleBoundaryAcknowledgmentHandoff(h.deps);
  h.deps.boundary.result = { accepted: false, reason: "stale pending state" };
  const result = await handoff.apply(h.acknowledgment, context(h.journal));
  assert.equal(result.status, "recovery-required"); assert.equal(result.reason, "stale pending state"); assert.equal(result.journalRestored, true);
  assert.equal(h.restored.length, 1); assert.equal(h.restored[0], h.journal);
  await handoff.apply(h.acknowledgment, context(h.journal)); assert.equal(h.restored.length, 2, "recovery can be retried without fabricating a new operation");
});

test("stale owner, session, operation and disposal fail closed and retain recovery", async () => {
  const h = api(), handoff = new h.api.WorkspaceLifecycleBoundaryAcknowledgmentHandoff(h.deps);
  h.state.active = other;
  assert.equal((await handoff.apply(h.acknowledgment, context(h.journal))).status, "recovery-required"); assert.equal(h.calls.length, 0); assert.equal(h.restored.length, 1);
  const h2 = api(), handoff2 = new h2.api.WorkspaceLifecycleBoundaryAcknowledgmentHandoff(h2.deps); h2.state.session = other;
  assert.equal((await handoff2.apply(h2.acknowledgment, context(h2.journal))).status, "recovery-required"); assert.equal(h2.calls.length, 0);
  const h3 = api(), handoff3 = new h3.api.WorkspaceLifecycleBoundaryAcknowledgmentHandoff(h3.deps);
  assert.equal((await handoff3.apply({ ...h3.acknowledgment, operationId: "dddddddd-dddd-4ddd-8ddd-dddddddddddd" }, context(h3.journal))).status, "recovery-required"); assert.equal(h3.calls.length, 0);
  const h4 = api(), handoff4 = new h4.api.WorkspaceLifecycleBoundaryAcknowledgmentHandoff(h4.deps); handoff4.dispose();
  assert.equal((await handoff4.apply(h4.acknowledgment, context(h4.journal))).status, "recovery-required"); assert.equal(h4.calls.length, 0);
});

test("concurrent duplicate handoffs share one attempt, and failed restoration remains explicit", async () => {
  const h = api(), handoff = new h.api.WorkspaceLifecycleBoundaryAcknowledgmentHandoff(h.deps);
  const [first, second] = await Promise.all([handoff.apply(h.acknowledgment, context(h.journal)), handoff.apply(h.acknowledgment, context(h.journal))]);
  assert.equal(first.status, "applied"); assert.equal(second.status, "applied"); assert.equal(h.calls.length, 1);
  const failed = api(), failingHandoff = new failed.api.WorkspaceLifecycleBoundaryAcknowledgmentHandoff(failed.deps);
  failed.deps.boundary.result = { accepted: false, reason: "storage confirmation failed" }; failed.deps.storage.fail = true;
  const result = await failingHandoff.apply(failed.acknowledgment, context(failed.journal));
  assert.equal(result.status, "recovery-required"); assert.equal(result.journalRestored, false); assert.match(result.reason, /could not be restored/i);
});
