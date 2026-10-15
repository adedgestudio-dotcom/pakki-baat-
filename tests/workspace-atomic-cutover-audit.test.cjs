/* eslint-disable @typescript-eslint/no-require-imports */
const test = require("node:test"), assert = require("node:assert/strict"), fs = require("node:fs"), path = require("node:path"), ts = require("typescript"), vm = require("node:vm");
const source = ts.transpileModule(fs.readFileSync(path.join(__dirname, "../lib/workspace-atomic-cutover-contract.ts"), "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
const contractModule = { exports: {} };
vm.runInNewContext(source, { module: contractModule, exports: contractModule.exports, JSON, Object });
test("dormant guarded cutover maps every non-privileged persisted setter", () => {
  const workspace = fs.readFileSync(path.join(__dirname, "../app/workspace.tsx"), "utf8");
  const found = workspace.split(/\r?\n/).flatMap((line, index) => /\bset(Jobs|Payments|Reminders|Notes|CustomerPhones|Owner|Business)\s*\(/.test(line) ? [index + 1] : []);
  const result = contractModule.exports.verifyAtomicCutoverCoverage(found);
  assert.equal(result.complete, true, `Unmapped guarded-mode setter lines: ${result.required.filter(line => !result.covered.includes(line)).join(", ")}`);
  assert.equal(result.required.length, 45);
});
