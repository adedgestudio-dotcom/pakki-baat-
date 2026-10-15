/* eslint-disable @typescript-eslint/no-require-imports */
const test = require("node:test"), assert = require("node:assert/strict"), fs = require("node:fs"), path = require("node:path"), ts = require("typescript"), vm = require("node:vm");
const root = path.join(__dirname, "..");
const compile = name => ts.transpileModule(fs.readFileSync(path.join(root, "lib", name), "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
function api(backupMatches = false) {
  const mod = { exports: {} };
  vm.runInNewContext(compile("workspace-cloud-write-routing-contract.ts"), { module: mod, exports: mod.exports, require: name => {
    if (name === "./verified-workspace-backup") return { hasMatchingVerifiedBackupPrecondition: () => backupMatches };
    return {};
  } });
  return mod.exports;
}
const owner = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", other = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const snapshot = { jobs: [], payments: [], reminders: [], notes: [], customerPhones: {}, owner: { name: "A", phone: "" }, business: { name: "B" } };
const selected = source => ({ source, ownerId: source === "legacy-local" ? null : owner, guardedReachable: source === "guarded-signed-in", genericSaveCloudAllowed: source === "legacy-signed-in", reason: "test" });
const input = extra => ({ selection: selected("guarded-signed-in"), expectedOwnerId: owner, activeOwnerId: owner, sessionOwnerId: owner, recoveryWriteBlocked: false, operationId: "op-1", preMutationSnapshot: snapshot, verifiedBackup: {}, ...extra });

test("inventory statically classifies every direct live persistence call", () => {
  const a = api(), workspace = fs.readFileSync(path.join(root, "app/workspace.tsx"), "utf8");
  assert.equal(a.WORKSPACE_CLOUD_WRITE_PATHS.length, 9);
  for (const route of a.WORKSPACE_CLOUD_WRITE_PATHS) assert.equal(workspace.includes(route.sourceAnchor), true, `Unclassified or moved direct path: ${route.path}`);
  const directCloudCalls = [...workspace.matchAll(/\bsaveCloud\s*\(/g)].length;
  const directBackups = [...workspace.matchAll(/\bsaveWorkspaceBackup\s*\(/g)].length;
  assert.equal(directCloudCalls, 5, "A new direct saveCloud path requires an explicit routing-contract entry.");
  assert.equal(directBackups, 3, "A new direct backup path requires an explicit routing-contract entry.");
  assert.equal([...workspace.matchAll(/\bmarkLedgerDirty\s*\(/g)].length, 1, "A new ledger-dirty path requires explicit classification.");
  const localWriteCalls = workspace.split(/\r?\n/).filter(line => /\bwriteLocalWorkspace\s*\(/.test(line) && !/\bfunction\s+writeLocalWorkspace\s*\(/.test(line)).length;
  assert.equal(localWriteCalls, 1, "A new legacy local-write path requires explicit classification.");
});

test("legacy local and signed-in sources retain only their existing routes", () => {
  const a = api();
  const local = a.decideWorkspaceCloudWriteRoute("legacy-local-workspace-write", input({ selection: selected("legacy-local"), expectedOwnerId: null, activeOwnerId: null, sessionOwnerId: null }));
  assert.equal(local.allowed, true); assert.equal(local.mayUseLegacyLocalWrite, true); assert.equal(local.mayUseGenericSaveCloud, false);
  assert.equal(a.decideWorkspaceCloudWriteRoute("reminder-save", input({ selection: selected("legacy-local"), expectedOwnerId: null, activeOwnerId: null, sessionOwnerId: null })).allowed, false);
  const signed = a.decideWorkspaceCloudWriteRoute("legacy-generic-autosave", input({ selection: selected("legacy-signed-in") }));
  assert.equal(signed.allowed, true); assert.equal(signed.mayUseGenericSaveCloud, true);
});

test("guarded paths never fall back to legacy local, ledger-dirty, or generic cloud writes", () => {
  const a = api();
  for (const path of ["legacy-local-workspace-write", "legacy-ledger-dirty-mark", "legacy-ledger-retry", "legacy-generic-autosave"]) {
    const decision = a.decideWorkspaceCloudWriteRoute(path, input());
    assert.equal(decision.allowed, false, path); assert.equal(decision.mayUseLegacyLocalWrite, false); assert.equal(decision.mayUseGenericLedgerDirty, false); assert.equal(decision.mayUseGenericSaveCloud, false);
  }
  const journal = a.decideWorkspaceCloudWriteRoute("reminder-save", input());
  assert.equal(journal.allowed, true); assert.equal(journal.requiresExactJournalAcknowledgment, true); assert.equal(journal.mayUseGenericSaveCloud, false);
});

test("guarded owner/session switches, stale recovery, and missing operation identity fail closed", () => {
  const a = api();
  assert.equal(a.decideWorkspaceCloudWriteRoute("reminder-save", input({ activeOwnerId: other })).allowed, false);
  assert.equal(a.decideWorkspaceCloudWriteRoute("reminder-save", input({ sessionOwnerId: other })).allowed, false);
  assert.equal(a.decideWorkspaceCloudWriteRoute("reminder-save", input({ recoveryWriteBlocked: true })).allowed, false);
  assert.equal(a.decideWorkspaceCloudWriteRoute("reminder-save", input({ operationId: "" })).allowed, false);
});

test("destructive guarded paths require a matching verified backup precondition", () => {
  const reject = api(false);
  const denied = reject.decideWorkspaceCloudWriteRoute("undo-save", input());
  assert.equal(denied.allowed, false); assert.match(denied.reason, /matching verified backup proof/);
  const accept = api(true);
  const allowed = accept.decideWorkspaceCloudWriteRoute("undo-save", input());
  assert.equal(allowed.allowed, true); assert.equal(allowed.requiresVerifiedBackupPreflight, true); assert.equal(allowed.requiresExactJournalAcknowledgment, true); assert.equal(allowed.mayUseGenericSaveCloud, false);
});
