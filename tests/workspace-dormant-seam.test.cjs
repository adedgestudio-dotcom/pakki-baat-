/* eslint-disable @typescript-eslint/no-require-imports */
const test = require("node:test"), assert = require("node:assert/strict"), fs = require("node:fs"), path = require("node:path"), ts = require("typescript"), vm = require("node:vm");
const root = path.join(__dirname, "..");
const compile = name => ts.transpileModule(fs.readFileSync(path.join(root, "lib", name), "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
function policy() { const cutover = { exports: {} }, source = { exports: {} }; vm.runInNewContext(compile("workspace-guarded-cutover.ts"), { module: cutover, exports: cutover.exports }); vm.runInNewContext(compile("workspace-source-selection-policy.ts"), { module: source, exports: source.exports, require: n => n === "./workspace-guarded-cutover" ? cutover.exports : {} }); return { ...cutover.exports, ...source.exports }; }
test("dormant workspace seam is hard-coded fail-closed and retains legacy autosave", () => {
  const workspace = fs.readFileSync(path.join(root, "app/workspace.tsx"), "utf8"), a = policy();
  assert.match(workspace, /import \{ decideWorkspaceSource \} from "@\/lib\/workspace-source-selection-policy"/);
  assert.match(workspace, /import \{ GUARDED_REDUCER_STAGING_FLAG_DEFAULT \} from "@\/lib\/workspace-guarded-cutover"/);
  assert.match(workspace, /migratedUserMutationCount: 0/);
  assert.match(workspace, /auditedUserMutationCount: 45/);
  assert.match(workspace, /remainingDirectUserMutationCount: 45/);
  assert.match(workspace, /specialWorkflowsReady: false/);
  assert.match(workspace, /import \{ WorkspaceGuardedRuntime \} from "@\/lib\/workspace-guarded-runtime"/);
  assert.match(workspace, /if \(!dormantWorkspaceSource\.guardedReachable \|\| !dormantWorkspaceSource\.ownerId\) return;/);
  assert.match(workspace, /const runtime = new WorkspaceGuardedRuntime/);
  assert.doesNotMatch(workspace, /new WorkspaceSnapshotCompatibilityController/);
  assert.match(workspace, /void saveCloud\(snapshot, storageUserId\)/);
  const selected = a.decideWorkspaceSource({ signedIn: true, ownerId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", requestedGuarded: a.GUARDED_REDUCER_STAGING_FLAG_DEFAULT, environment: "staging", migratedUserMutationCount: 0, auditedUserMutationCount: 45, remainingDirectUserMutationCount: 45, specialWorkflowsReady: false });
  assert.equal(selected.source, "legacy-signed-in");
  assert.equal(selected.genericSaveCloudAllowed, true);
});
