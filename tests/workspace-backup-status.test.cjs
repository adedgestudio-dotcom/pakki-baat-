/* eslint-disable @typescript-eslint/no-require-imports */
const test = require("node:test"), assert = require("node:assert/strict"), fs = require("node:fs"), path = require("node:path"), ts = require("typescript"), vm = require("node:vm");
const root = path.join(__dirname, "..");
const compile = name => ts.transpileModule(fs.readFileSync(path.join(root, "lib", name), "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
const owner = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";

function present(input) {
  const mod = { exports: {} };
  vm.runInNewContext(compile("workspace-backup-status.ts"), { module: mod, exports: mod.exports, require: () => ({}) });
  return mod.exports.presentWorkspaceBackupStatus(input);
}

const idle = { state: "idle" };
const current = (state, extra = {}) => ({ state, ownerId: owner, generation: 4, ...extra });

test("presentation keeps cloud saves and recovery copies distinct", () => {
  const result = present({ cloud: current("saved"), recovery: current("saving", { attempt: 1 }), ownerId: owner, generation: 4 });
  assert.equal(result.cloud.label, "Workspace saved");
  assert.equal(result.recovery.label, "Creating today’s recovery copy…");
});

test("recovery copy is ready only after the coordinator confirms its current generation", () => {
  assert.equal(present({ cloud: current("saved"), recovery: current("confirmed"), ownerId: owner, generation: 4 }).recovery.label, "Today’s recovery copy is ready");
  assert.notEqual(present({ cloud: current("saved"), recovery: current("confirmed"), ownerId: owner, generation: 5 }).recovery.label, "Today’s recovery copy is ready");
});

test("retries are neutral while terminal failure is quiet and separate from cloud success", () => {
  const retrying = present({ cloud: current("saved"), recovery: current("retrying", { attempt: 1, retryInMs: 5000 }), ownerId: owner, generation: 4 });
  assert.equal(retrying.recovery.tone, "neutral");
  assert.equal(retrying.recovery.label, "Preparing a recovery copy…");
  const failed = present({ cloud: current("saved"), recovery: current("failed", { attempts: 4 }), ownerId: owner, generation: 4 });
  assert.equal(failed.cloud.label, "Workspace saved");
  assert.equal(failed.recovery.tone, "warning");
  assert.match(failed.recovery.detail, /was saved/);
});

test("offline, unavailable, idle, and cancelled states never claim a confirmed recovery copy", () => {
  for (const cloud of [current("offline"), current("unavailable"), idle]) {
    const result = present({ cloud, recovery: { state: "cancelled" }, ownerId: owner, generation: 4 });
    assert.notEqual(result.recovery.label, "Today’s recovery copy is ready");
  }
  assert.equal(present({ cloud: current("offline"), recovery: idle, ownerId: owner, generation: 4 }).cloud.label, "Offline — changes stay on this device");
});

test("production wiring passes guarded statuses to CloudSettings without adding another retry path", () => {
  const workspace = fs.readFileSync(path.join(root, "app", "workspace.tsx"), "utf8");
  const settings = fs.readFileSync(path.join(root, "app", "cloud-settings.tsx"), "utf8");
  assert.match(workspace, /onStatus: \(status\) =>/);
  assert.match(workspace, /cloudSaveStatus=\{cloudSaveStatus\}/);
  assert.match(workspace, /dailyBackupStatus=\{dailyBackupStatus\}/);
  assert.match(settings, /presentWorkspaceBackupStatus/);
  assert.match(settings, /Available for restore/);
  assert.doesNotMatch(settings, /healthy\?"✓ Verified"/);
  assert.doesNotMatch(workspace, /saveVerifiedWorkspaceBackup/);
});
