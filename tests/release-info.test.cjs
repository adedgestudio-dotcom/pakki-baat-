const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const ts = require("typescript");
const pkg = require("../package.json");
const lock = require("../package-lock.json");

test("release-info reports the package version and retains dependency details without caching", async () => {
  const source = fs.readFileSync(path.join(__dirname, "../app/api/release-info/route.ts"), "utf8");
  const output = ts.transpileModule(source, { compilerOptions: {
    module: ts.ModuleKind.CommonJS, esModuleInterop: true,
  } }).outputText;
  const exports = {};
  vm.runInNewContext(output, {
    exports, Response, process: { env: {} },
    require: name => {
      if (name === "@/package.json") return pkg;
      if (name === "@/package-lock.json") return lock;
      throw new Error("Unexpected import: " + name);
    },
  });
  const response = exports.GET();
  const data = await response.json();
  assert.equal(data.version, pkg.version);
  assert.equal(data.version, "1.0.0");
  assert.equal(response.headers.get("Cache-Control"), "no-store");
  assert.equal(data.dependencies.next, lock.packages["node_modules/next"].version);
  assert.equal(data.dependencies.workflow, lock.packages["node_modules/workflow"].version);
  assert.equal(data.dependencies.react, lock.packages["node_modules/react"].version);
});
