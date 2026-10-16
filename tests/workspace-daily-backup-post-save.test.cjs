/* eslint-disable @typescript-eslint/no-require-imports */
const test = require("node:test"), assert = require("node:assert/strict"), fs = require("node:fs"), path = require("node:path"), ts = require("typescript"), vm = require("node:vm");
const root = path.join(__dirname, "..");
const compile = name => ts.transpileModule(fs.readFileSync(path.join(root, "lib", name), "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
const owner = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", other = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const snapshot = name => ({ jobs: [], payments: [], reminders: [], notes: [], customerPhones: {}, owner: name, business: "Synthetic" });

function harness(saveDailyBackup = async () => {}) {
  const coordinator = { exports: {} }, lifecycle = { exports: {} }, postSave = { exports: {} }, calls = [];
  vm.runInNewContext(compile("workspace-daily-backup-coordinator.ts"), { module: coordinator, exports: coordinator.exports, require: () => ({}), setTimeout, clearTimeout, Date, Promise });
  vm.runInNewContext(compile("workspace-daily-backup-lifecycle.ts"), { module: lifecycle, exports: lifecycle.exports, require: name => name === "./workspace-daily-backup-coordinator" ? coordinator.exports : {}, Promise });
  vm.runInNewContext(compile("workspace-daily-backup-post-save.ts"), { module: postSave, exports: postSave.exports, require: name => ({ "./workspace-daily-backup-lifecycle": lifecycle.exports })[name] || {}, Promise });
  const backup = new coordinator.exports.WorkspaceDailyBackupCoordinator({
    saveDailyBackup: async (value, id) => { calls.push([value.owner, id]); await saveDailyBackup(); },
    now: () => new Date("2026-10-16T12:00:00.000Z"),
    schedule: () => ({}),
    cancelSchedule: () => {},
  });
  const state = { disposed: false, activeOwner: owner, sessionOwner: owner, autosavePaused: false, recoveryBlocked: false, generation: 1 };
  const input = extra => ({ lifecycle: new lifecycle.exports.WorkspaceDailyBackupLifecycle(backup), snapshot: snapshot("current"), ownerId: owner, snapshotGeneration: 1, isDisposed: () => state.disposed, activeOwnerId: () => state.activeOwner, isAutosavePaused: () => state.autosavePaused, isRecoveryBlocked: () => state.recoveryBlocked, currentSnapshotGeneration: () => state.generation, currentSession: async () => state.sessionOwner ? { user: { id: state.sessionOwner } } : null, ...extra });
  return { schedule: postSave.exports.scheduleDailyBackupAfterCloudSave, state, input, calls };
}

test("real post-save helper schedules successful normal autosave and ledger retry acknowledgements", async () => {
  const normal = harness();
  assert.equal(await normal.schedule(normal.input()), true);
  assert.deepEqual(normal.calls, [["current", owner]]);
  const ledger = harness();
  assert.equal(await ledger.schedule(ledger.input({ snapshot: snapshot("ledger-retry"), snapshotGeneration: 1 })), true);
  assert.deepEqual(ledger.calls, [["ledger-retry", owner]]);
});

test("delayed normal saveCloud completion after logout never invokes the legacy backup RPC", async () => {
  const h = harness(); let resolveCloud; const cloud = new Promise(resolve => { resolveCloud = resolve; });
  const continuation = cloud.then(() => h.schedule(h.input()));
  h.state.activeOwner = null; h.state.sessionOwner = null; resolveCloud(); await continuation;
  assert.deepEqual(h.calls, []);
});

test("delayed ledger retry completion after unmount or account switch never invokes the legacy backup RPC", async () => {
  const h = harness(); let resolveCloud; const cloud = new Promise(resolve => { resolveCloud = resolve; });
  const continuation = cloud.then(() => h.schedule(h.input()));
  h.state.disposed = true; h.state.activeOwner = other; h.state.sessionOwner = other; resolveCloud(); await continuation;
  assert.deepEqual(h.calls, []);
});

test("recovery block, autosave pause, and newer generation each block the real post-save helper", async () => {
  for (const change of [state => { state.recoveryBlocked = true; }, state => { state.autosavePaused = true; }, state => { state.generation = 2; }]) {
    const h = harness(); change(h.state); await h.schedule(h.input()); assert.deepEqual(h.calls, []);
  }
});

test("a session change during the helper's currentSession recheck blocks the backup RPC", async () => {
  const h = harness(); let resolveSession; const session = new Promise(resolve => { resolveSession = resolve; });
  const scheduled = h.schedule(h.input({ currentSession: () => session }));
  h.state.sessionOwner = other; resolveSession({ user: { id: other } }); await scheduled;
  assert.deepEqual(h.calls, []);
});

test("backup failure remains independent of the successful post-save continuation", async () => {
  const h = harness(async () => { throw new Error("backup unavailable"); });
  assert.equal(await h.schedule(h.input()), true);
  assert.deepEqual(h.calls, [["current", owner]]);
});

test("Workspace directly imports and invokes the tested helper from both post-save paths", () => {
  const source = fs.readFileSync(path.join(root, "app", "workspace.tsx"), "utf8");
  assert.match(source, /import \{ scheduleDailyBackupAfterCloudSave \} from "@\/lib\/workspace-daily-backup-post-save"/);
  assert.equal([...source.matchAll(/scheduleDailyBackupAfterCloudSave\(\{/g)].length, 2);
});
