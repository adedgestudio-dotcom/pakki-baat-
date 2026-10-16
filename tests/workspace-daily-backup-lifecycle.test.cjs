/* eslint-disable @typescript-eslint/no-require-imports */
const test = require("node:test"), assert = require("node:assert/strict"), fs = require("node:fs"), path = require("node:path"), ts = require("typescript"), vm = require("node:vm");
const root = path.join(__dirname, "..");
const compile = name => ts.transpileModule(fs.readFileSync(path.join(root, "lib", name), "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
const owner = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", other = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const snapshot = name => ({ jobs: [], payments: [], reminders: [], notes: [], customerPhones: {}, owner: name, business: "Synthetic" });
const tick = () => new Promise(resolve => setImmediate(resolve));

function harness() {
  const coordinatorModule = { exports: {} }, lifecycleModule = { exports: {} }, calls = [];
  const context = { module: coordinatorModule, exports: coordinatorModule.exports, require: () => ({}), setTimeout, clearTimeout, Date, Promise };
  vm.runInNewContext(compile("workspace-daily-backup-coordinator.ts"), context);
  vm.runInNewContext(compile("workspace-daily-backup-lifecycle.ts"), {
    module: lifecycleModule, exports: lifecycleModule.exports,
    require: name => name === "./workspace-daily-backup-coordinator" ? coordinatorModule.exports : {},
  });
  const coordinator = new coordinatorModule.exports.WorkspaceDailyBackupCoordinator({
    saveDailyBackup: async (value, id) => calls.push([value.owner, id]),
    now: () => new Date("2026-10-16T12:00:00.000Z"),
  });
  return { lifecycle: new lifecycleModule.exports.WorkspaceDailyBackupLifecycle(coordinator), calls };
}

function eligibility(state, expectedOwner, generation) {
  return async () => state.mounted && !state.recoveryBlocked && !state.autosavePaused
    && state.activeOwner === expectedOwner && state.sessionOwner === expectedOwner && state.generation === generation;
}

test("actual lifecycle schedules a current normal autosave acknowledgement", async () => {
  const h = harness(), state = { mounted: true, recoveryBlocked: false, autosavePaused: false, activeOwner: owner, sessionOwner: owner, generation: 1 };
  await h.lifecycle.schedule({ ownerId: owner, snapshot: snapshot("normal"), snapshotGeneration: 1, canAttempt: eligibility(state, owner, 1) });
  assert.deepEqual(h.calls, [["normal", owner]]);
});

test("actual lifecycle schedules a current ledger-retry acknowledgement", async () => {
  const h = harness(), state = { mounted: true, recoveryBlocked: false, autosavePaused: false, activeOwner: owner, sessionOwner: owner, generation: 4 };
  await h.lifecycle.schedule({ ownerId: owner, snapshot: snapshot("ledger-retry"), snapshotGeneration: 4, canAttempt: eligibility(state, owner, 4) });
  assert.deepEqual(h.calls, [["ledger-retry", owner]]);
});

test("late normal cloud-save continuation after logout cannot invoke the backup RPC", async () => {
  const h = harness(), state = { mounted: true, recoveryBlocked: false, autosavePaused: false, activeOwner: owner, sessionOwner: owner, generation: 1 };
  let resolveCloud; const cloud = new Promise(resolve => { resolveCloud = resolve; });
  const continuation = cloud.then(() => h.lifecycle.schedule({ ownerId: owner, snapshot: snapshot("late"), snapshotGeneration: 1, canAttempt: eligibility(state, owner, 1) }));
  state.activeOwner = null; state.sessionOwner = null; h.lifecycle.invalidate(); resolveCloud(); await continuation;
  assert.deepEqual(h.calls, []);
});

test("late ledger retry after unmount or account switch cannot invoke the backup RPC", async () => {
  const h = harness(), state = { mounted: true, recoveryBlocked: false, autosavePaused: false, activeOwner: owner, sessionOwner: owner, generation: 2 };
  let resolveCloud; const cloud = new Promise(resolve => { resolveCloud = resolve; });
  const continuation = cloud.then(() => h.lifecycle.schedule({ ownerId: owner, snapshot: snapshot("late-ledger"), snapshotGeneration: 2, canAttempt: eligibility(state, owner, 2) }));
  state.mounted = false; state.activeOwner = other; state.sessionOwner = other; h.lifecycle.invalidate(); resolveCloud(); await continuation;
  assert.deepEqual(h.calls, []);
});

test("recovery and autosave blocks reject a resolved continuation before the backup dependency", async () => {
  const h = harness(), state = { mounted: true, recoveryBlocked: false, autosavePaused: false, activeOwner: owner, sessionOwner: owner, generation: 3 };
  state.recoveryBlocked = true;
  await h.lifecycle.schedule({ ownerId: owner, snapshot: snapshot("recovery"), snapshotGeneration: 3, canAttempt: eligibility(state, owner, 3) });
  state.recoveryBlocked = false; state.autosavePaused = true;
  await h.lifecycle.schedule({ ownerId: owner, snapshot: snapshot("paused"), snapshotGeneration: 3, canAttempt: eligibility(state, owner, 3) });
  assert.deepEqual(h.calls, []);
});

test("a superseding snapshot invalidates an in-flight old eligibility check", async () => {
  const h = harness(), state = { mounted: true, recoveryBlocked: false, autosavePaused: false, activeOwner: owner, sessionOwner: owner, generation: 1 };
  let releaseOld; const oldEligibility = () => new Promise(resolve => { releaseOld = resolve; });
  const old = h.lifecycle.schedule({ ownerId: owner, snapshot: snapshot("old"), snapshotGeneration: 1, canAttempt: oldEligibility });
  state.generation = 2;
  const current = h.lifecycle.schedule({ ownerId: owner, snapshot: snapshot("new"), snapshotGeneration: 2, canAttempt: eligibility(state, owner, 2) });
  releaseOld(true); await Promise.all([old, current]); await tick();
  assert.deepEqual(h.calls, [["new", owner]]);
});
