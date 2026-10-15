/* eslint-disable @typescript-eslint/no-require-imports */
const test = require("node:test"), assert = require("node:assert/strict"), fs = require("node:fs"), path = require("node:path"), ts = require("typescript"), vm = require("node:vm"), crypto = require("node:crypto");
const { fixtures: digestFixtures, jsonbEdges } = require("./verified-workspace-backup-digest-fixtures.cjs");
const root = path.join(__dirname, "..");
const compile = name => ts.transpileModule(fs.readFileSync(path.join(root, "lib", name), "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
const data = { exports: {} }, special = { exports: {} }, backup = { exports: {} };
vm.runInNewContext(compile("data.ts"), { module: data, exports: data.exports });
vm.runInNewContext(compile("workspace-special-workflow.ts"), { module: special, exports: special.exports, require: () => ({}) });
vm.runInNewContext(compile("verified-workspace-backup.ts"), {
  module: backup, exports: backup.exports, TextEncoder, crypto: crypto.webcrypto,
  require: name => name === "./data" ? data.exports : name === "./workspace-special-workflow" ? special.exports : (() => { throw new Error("Unexpected import " + name); })(),
});
const api = backup.exports;
const owner = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", backupId = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const snapshot = () => ({ jobs: [], owner: "Owner", business: "Business", reminders: [], payments: [], notes: [], customerPhones: { "Åsha": "919999999999" } });
const sha = value => crypto.createHash("sha256").update(value).digest("hex");
const specialInput = extra => ({ ownerMatches: true, storageHealthy: true, cloudAvailable: true, ledgerDirtyConflict: false, journal: null, latestOperationId: null, cloudConflict: false, ...extra });
const confirmation = extra => ({ backupId, ownerId: owner, kind: "pre_restore", payloadSha256: "a".repeat(64), createdAt: "2026-10-11T00:00:00.000Z", ...extra });

test("canonical JSONB text has PostgreSQL separators and length/byte ordered keys", () => {
  const value = { bb: 2, a: 1, "Å": 3, z: [true, null] };
  assert.equal(api.canonicalJsonbText(value), '{"a": 1, "z": [true, null], "bb": 2, "Å": 3}');
  assert.equal(sha(api.canonicalJsonbText({ b: 2, a: 1 })), sha('{"a": 1, "b": 2}'));
  assert.throws(() => api.canonicalJsonbText({ value: 1e21 }), /cannot be proven/i);
});

test("TypeScript SHA-256 matches staging PostgreSQL JSONB digests for supported Snapshot fixtures", async () => {
  const stagingDigests = {
    escaping: "c9d2374d41ae937138c981601da3b5bb5f1ea4d26db5db3c23769be94e4da76b",
    key_ordering: "90a630f4902dd3aeca7538783383c9fc686618831f616c74c1c76eb656d69160",
    nested: "95cb91b1d276f755096942210febe7882e46a78d58d90f27c5fe30a6c2095e18",
    numeric_decimal: "07f1b8645baaca842f09632563a1a2eb75bc9320b6a493f288f94e744df5942e",
  };
  for (const [name, expected] of Object.entries(stagingDigests)) {
    assert.equal(await api.canonicalWorkspaceSnapshotDigest(digestFixtures[name]), expected, name);
  }
});

test("TypeScript canonicalizer matches the staging null, boolean, and array JSONB edge case", () => {
  const text = api.canonicalJsonbText(jsonbEdges.null_boolean_array);
  assert.equal(text, '{"a": [true, false, null, {"a": "y", "bb": "x"}], "z": null}');
  assert.equal(sha(text), "2a9d2834033a4df85d3836570fffc3838affa8692f588a7a94e19074cd60db06");
});

test("confirmation requires exact owner, kind, id, timestamp, and server digest", async () => {
  const value = snapshot();
  const accepted = await api.verifyWorkspaceBackupConfirmation(value, owner, "pre_restore", {
    backup_id: backupId, owner_id: owner, backup_kind: "pre_restore", payload_sha256: "a".repeat(64), created_at: "2026-10-11T00:00:00.000Z",
  }, async () => "a".repeat(64));
  assert.equal(accepted.backupId, backupId);
  await assert.rejects(api.verifyWorkspaceBackupConfirmation(value, owner, "pre_restore", { backup_id: backupId, owner_id: "cccccccc-cccc-4ccc-8ccc-cccccccccccc", backup_kind: "pre_restore", payload_sha256: "a".repeat(64), created_at: "2026-10-11T00:00:00.000Z" }, async () => "a".repeat(64)), /different account/i);
  await assert.rejects(api.verifyWorkspaceBackupConfirmation(value, owner, "pre_restore", { backup_id: backupId, owner_id: owner, backup_kind: "daily", payload_sha256: "a".repeat(64), created_at: "2026-10-11T00:00:00.000Z" }, async () => "a".repeat(64)), /different account or kind/i);
  await assert.rejects(api.verifyWorkspaceBackupConfirmation(value, owner, "pre_restore", { backup_id: backupId, owner_id: owner, backup_kind: "pre_restore", payload_sha256: "b".repeat(64), created_at: "2026-10-11T00:00:00.000Z" }, async () => "a".repeat(64)), /does not match/i);
  await assert.rejects(api.verifyWorkspaceBackupConfirmation(value, owner, "pre_restore", null, async () => "a".repeat(64)), /no confirmation/i);
});

test("coordinator confirms only an exact backup and refuses network, owner, and session failures", async () => {
  const value = snapshot();
  const input = { operationId: "op-1", ownerId: owner, snapshot: value, workflow: "undo", special: specialInput() };
  const good = api.createVerifiedBackupCoordinator({ activeOwnerId: async () => owner, saveVerifiedBackup: async () => confirmation(), snapshotDigest: async () => "a".repeat(64) });
  const protectedResult = await good.protectBeforeDestructiveOperation(input);
  assert.equal(protectedResult.confirmed, true);
  assert.equal(api.hasMatchingVerifiedBackupPrecondition(protectedResult.precondition, owner, "op-1", value), true);
  assert.equal(api.hasMatchingVerifiedBackupPrecondition(protectedResult.precondition, owner, "other-op", value), false);
  assert.equal(api.hasMatchingVerifiedBackupPrecondition(protectedResult.precondition, owner, "op-1", { ...value, owner: "Changed" }), false);
  const wrongOwner = api.createVerifiedBackupCoordinator({ activeOwnerId: async () => owner, saveVerifiedBackup: async () => confirmation({ ownerId: "cccccccc-cccc-4ccc-8ccc-cccccccccccc" }), snapshotDigest: async () => "a".repeat(64) });
  assert.equal((await wrongOwner.protectBeforeDestructiveOperation(input)).confirmed, false);
  const network = api.createVerifiedBackupCoordinator({ activeOwnerId: async () => owner, saveVerifiedBackup: async () => { throw new Error("network down"); }, snapshotDigest: async () => "a".repeat(64) });
  assert.equal((await network.protectBeforeDestructiveOperation(input)).confirmed, false);
  let call = 0;
  const switched = api.createVerifiedBackupCoordinator({ activeOwnerId: async () => ++call === 1 ? owner : "cccccccc-cccc-4ccc-8ccc-cccccccccccc", saveVerifiedBackup: async () => confirmation(), snapshotDigest: async () => "a".repeat(64) });
  assert.equal((await switched.protectBeforeDestructiveOperation(input)).confirmed, false);
});

test("coordinator blocks duplicate in-flight operations without issuing a second backup", async () => {
  let release, calls = 0;
  const pending = new Promise(resolve => { release = resolve; });
  const coordinator = api.createVerifiedBackupCoordinator({ activeOwnerId: async () => owner, saveVerifiedBackup: async () => { calls += 1; await pending; return confirmation(); }, snapshotDigest: async () => "a".repeat(64) });
  const input = { operationId: "op-duplicate", ownerId: owner, snapshot: snapshot(), workflow: "import-restore", special: specialInput() };
  const first = coordinator.protectBeforeDestructiveOperation(input);
  const second = await coordinator.protectBeforeDestructiveOperation(input);
  assert.equal(second.confirmed, false);
  assert.match(second.reason, /already awaiting/i);
  release();
  assert.equal((await first).confirmed, true);
  assert.equal(calls, 1);
});
