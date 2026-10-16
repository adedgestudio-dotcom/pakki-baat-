/* eslint-disable @typescript-eslint/no-require-imports */
const test = require("node:test"), assert = require("node:assert/strict"), fs = require("node:fs"), path = require("node:path"), ts = require("typescript"), vm = require("node:vm");
const root = path.join(__dirname, "..");
const compile = name => ts.transpileModule(fs.readFileSync(path.join(root, "lib", name), "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
const snapshot = name => ({ jobs: [], payments: [], reminders: [], notes: [], customerPhones: {}, owner: name, business: "Synthetic" });
const owner = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", other = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";

function harness(save = async () => {}) {
  const mod = { exports: {} }, timers = [], statuses = [];
  vm.runInNewContext(compile("workspace-daily-backup-coordinator.ts"), { module: mod, exports: mod.exports, require: () => ({}) });
  const coordinator = new mod.exports.WorkspaceDailyBackupCoordinator({
    saveDailyBackup: save,
    now: () => new Date("2026-10-16T12:00:00.000Z"),
    schedule: (callback, delay) => { const timer = { callback, delay, cancelled: false }; timers.push(timer); return timer; },
    cancelSchedule: timer => { timer.cancelled = true; },
    onStatus: value => statuses.push(value),
  });
  return { coordinator, timers, statuses };
}

async function runNext(timer) { assert.equal(timer.cancelled, false); timer.callback(); await new Promise(resolve => setImmediate(resolve)); }

test("acknowledged cloud save creates and confirms one legacy daily backup", async () => {
  const calls = [], h = harness(async (value, id) => calls.push([value, id]));
  await h.coordinator.acknowledge({ ownerId: owner, generation: 1, snapshot: snapshot("one") });
  assert.equal(calls.length, 1); assert.equal(calls[0][1], owner); assert.equal(h.coordinator.status.state, "confirmed");
});

test("same owner, UTC day, and generation is deduplicated while a newer generation updates it", async () => {
  const calls = [], h = harness(async value => calls.push(value.owner));
  await h.coordinator.acknowledge({ ownerId: owner, generation: 1, snapshot: snapshot("one") });
  await h.coordinator.acknowledge({ ownerId: owner, generation: 1, snapshot: snapshot("one") });
  await h.coordinator.acknowledge({ ownerId: owner, generation: 2, snapshot: snapshot("two") });
  assert.deepEqual(calls, ["one", "two"]);
});

test("failed backup retries at the bounded 5s, 30s, and 2m intervals before final failure", async () => {
  let calls = 0; const h = harness(async () => { calls += 1; throw new Error("offline"); });
  await h.coordinator.acknowledge({ ownerId: owner, generation: 1, snapshot: snapshot("one") });
  assert.equal(h.timers[0].delay, 5_000); await runNext(h.timers[0]);
  assert.equal(h.timers[1].delay, 30_000); await runNext(h.timers[1]);
  assert.equal(h.timers[2].delay, 120_000); await runNext(h.timers[2]);
  assert.equal(calls, 4); assert.equal(JSON.stringify(h.coordinator.status), JSON.stringify({ state: "failed", ownerId: owner, generation: 1, attempts: 4 }));
});

test("a retry that succeeds confirms the same snapshot generation", async () => {
  let calls = 0; const h = harness(async () => { calls += 1; if (calls === 1) throw new Error("offline"); });
  await h.coordinator.acknowledge({ ownerId: owner, generation: 1, snapshot: snapshot("one") });
  assert.equal(h.timers[0].delay, 5_000);
  await runNext(h.timers[0]);
  assert.equal(calls, 2); assert.equal(h.coordinator.status.state, "confirmed");
});

test("owner switch cancellation prevents a stale retry", async () => {
  let calls = 0; const h = harness(async () => { calls += 1; throw new Error("offline"); });
  await h.coordinator.acknowledge({ ownerId: owner, generation: 1, snapshot: snapshot("one") });
  h.coordinator.cancel();
  assert.equal(h.timers[0].cancelled, true); assert.equal(calls, 1); assert.equal(h.coordinator.status.state, "cancelled");
});

test("newer generation supersedes an older pending retry", async () => {
  let first = true; const calls = [], h = harness(async value => { calls.push(value.owner); if (first) { first = false; throw new Error("offline"); } });
  await h.coordinator.acknowledge({ ownerId: owner, generation: 1, snapshot: snapshot("old") });
  await h.coordinator.acknowledge({ ownerId: owner, generation: 2, snapshot: snapshot("new") });
  assert.equal(h.timers[0].cancelled, true); assert.deepEqual(calls, ["old", "new"]); assert.equal(h.coordinator.status.state, "confirmed");
});

test("recovery or autosave block cancellation prevents pending retries", async () => {
  const h = harness(async () => { throw new Error("offline"); });
  await h.coordinator.acknowledge({ ownerId: owner, generation: 1, snapshot: snapshot("one") });
  h.coordinator.cancel();
  assert.equal(h.timers[0].cancelled, true); assert.equal(h.coordinator.status.state, "cancelled");
});

test("a successful ledger cloud retry acknowledgement schedules the same daily backup confirmation", async () => {
  const calls = [], h = harness(async (value, id) => calls.push([value.owner, id]));
  await h.coordinator.acknowledge({ ownerId: other, generation: 7, snapshot: snapshot("ledger-retry") });
  assert.deepEqual(calls, [["ledger-retry", other]]); assert.equal(JSON.stringify(h.coordinator.status), JSON.stringify({ state: "confirmed", ownerId: other, generation: 7 }));
});
