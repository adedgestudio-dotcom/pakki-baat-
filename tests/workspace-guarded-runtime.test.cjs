/* eslint-disable @typescript-eslint/no-require-imports */
const test = require("node:test"), assert = require("node:assert/strict"), fs = require("node:fs"), path = require("node:path"), ts = require("typescript"), vm = require("node:vm");
const source = ts.transpileModule(fs.readFileSync(path.join(__dirname, "../lib/workspace-guarded-runtime.ts"), "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
const owner = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", other = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
function api() {
  const calls = { controllers: [], handoffs: [], lifecycles: [] }, mod = { exports: {} };
  class Controller { constructor() { this.resets = []; this.disposals = 0; calls.controllers.push(this); } privilegedOwnerReset(value) { this.resets.push(value); return { accepted: true }; } dispose() { this.disposals += 1; } }
  class Handoff { constructor(deps) { this.deps = deps; this.owners = 0; this.disposals = 0; this.deliveries = 0; calls.handoffs.push(this); } asLifecycleAcknowledgmentHandler() { return this.handler = () => { this.deliveries += 1; return Promise.resolve({ status: "applied" }); }; } onOwnerChanged() { this.owners += 1; } dispose() { this.disposals += 1; } }
  class Lifecycle { constructor(deps) { this.deps = deps; this.owners = []; this.disposals = 0; calls.lifecycles.push(this); } onOwnerChanged(value) { this.owners.push(value); } dispose() { this.disposals += 1; } }
  vm.runInNewContext(source, { module: mod, exports: mod.exports, require: name => ({ "./workspace-snapshot-controller": { WorkspaceSnapshotCompatibilityController: Controller }, "./workspace-lifecycle-boundary-handoff": { WorkspaceLifecycleBoundaryAcknowledgmentHandoff: Handoff }, "./workspace-journal-lifecycle-driver": { WorkspaceJournalLifecycleDriver: Lifecycle } })[name] || {} });
  return { Runtime: mod.exports.WorkspaceGuardedRuntime, calls };
}
function deps() { return { activeOwnerId: async () => owner, isOnline: () => true, readCurrentJournal: () => null, acknowledgeExactLocalJournal: () => {}, transport: async () => ({ status: "offline", reason: "offline" }), sourceSelection: () => ({ source: "guarded-signed-in", ownerId: owner }), schedule: () => {} }; }

test("runtime owns one controller and gives that exact controller to the acknowledgment handoff", async () => {
  const a = api(), runtime = new a.Runtime(deps());
  assert.equal(a.calls.controllers.length, 1); assert.equal(a.calls.handoffs.length, 1); assert.equal(a.calls.lifecycles.length, 1);
  assert.equal(a.calls.handoffs[0].deps.boundary, runtime.controller);
  await a.calls.lifecycles[0].deps.onAcknowledged({}, {});
  assert.equal(a.calls.handoffs[0].deliveries, 1);
});

test("owner changes and disposal invalidate the lifecycle, handoff, and controller once", () => {
  const a = api(), runtime = new a.Runtime(deps());
  runtime.onOwnerChanged(owner); runtime.onOwnerChanged(owner); runtime.onOwnerChanged(other);
  assert.deepEqual(a.calls.lifecycles[0].owners, [owner, other]); assert.equal(a.calls.handoffs[0].owners, 2); assert.deepEqual(a.calls.controllers[0].resets, [null, null]);
  runtime.dispose(); runtime.dispose();
  assert.equal(a.calls.lifecycles[0].disposals, 1); assert.equal(a.calls.handoffs[0].disposals, 1); assert.equal(a.calls.controllers[0].disposals, 1);
});
