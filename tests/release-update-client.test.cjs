const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const ts = require("typescript");

const root = path.join(__dirname, "..");
const helperSource = fs.readFileSync(path.join(root, "lib/release-update.ts"), "utf8");
const helperOutput = ts.transpileModule(helperSource, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText;
const helpers = {};
vm.runInNewContext(helperOutput, { exports: helpers });

const current = { version: "1.0.0", commit: "old-commit" };

test("a different server version or commit shows the update card while the same release hides it", () => {
  assert.equal(helpers.releaseCardVisible(current, { version: "1.0.1", commit: null }, true), true);
  assert.equal(helpers.releaseCardVisible(current, { version: "1.0.0", commit: "new-commit" }, true), true);
  assert.equal(helpers.releaseCardVisible(current, { ...current }, true), false);
  assert.equal(helpers.releaseCardVisible(current, { version: "1.0.1", commit: null }, false), false);
});

test("dirty entry, AI and voice states block update reload until they close", () => {
  for (const key of ["entryOpen", "hasDraft", "hasText", "voiceBusy"]) {
    assert.equal(helpers.updateReloadBlocked({ entryOpen: false, hasDraft: false, hasText: false, voiceBusy: false, [key]: true }), true, key);
  }
  assert.equal(helpers.updateReloadBlocked({ entryOpen: false, hasDraft: false, hasText: false, voiceBusy: false }), false);
  const workspace = fs.readFileSync(path.join(root, "app/workspace.tsx"), "utf8");
  assert.match(workspace, /updateReloadBlocked\(\{[\s\S]*entryOpen: customerChatOpen,[\s\S]*hasDraft: Boolean\(pendingJob\) \|\| Boolean\(draft\),[\s\S]*hasText: Boolean\(message\.trim\(\)\),[\s\S]*voiceBusy/);
});

test("client checks no-store on open, foreground and every 30 minutes without automatic reload", () => {
  const source = fs.readFileSync(path.join(root, "app/release-update.tsx"), "utf8");
  const ast = ts.createSourceFile("release-update.tsx", source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const effects = [];
  function visit(node) {
    if (ts.isCallExpression(node) && node.expression.getText(ast) === "useEffect") effects.push(node.getText(ast));
    ts.forEachChild(node, visit);
  }
  visit(ast);
  assert.equal(effects.length, 1);
  assert.ok(effects[0].includes('fetch("/api/release-info"'));
  assert.ok(effects[0].includes('cache: "no-store"'));
  assert.ok(effects[0].includes('document.addEventListener("visibilitychange"'));
  assert.ok(effects[0].includes("window.setInterval(checkForUpdate, CHECK_INTERVAL_MS)"));
  assert.ok(!effects[0].includes("location.reload"));
  assert.ok(source.includes("const CHECK_INTERVAL_MS = 30 * 60 * 1000"));
  assert.ok(source.includes("New version ready"));
  assert.ok(source.includes("disabled={blocked || updating}"));
});

test("update action activates a waiting worker and service worker keeps offline caching", () => {
  const client = fs.readFileSync(path.join(root, "app/release-update.tsx"), "utf8");
  const worker = fs.readFileSync(path.join(root, "public/sw.js"), "utf8");
  assert.ok(client.includes('waiting.postMessage("SKIP_WAITING")'));
  assert.ok(client.includes('addEventListener("controllerchange", reload'));
  assert.ok(worker.includes('if (event.data === "SKIP_WAITING") self.skipWaiting()'));
  const install = worker.match(/self\.addEventListener\("install"[\s\S]*?\n\}\);/)[0];
  assert.ok(!install.includes("self.skipWaiting()"));
  assert.ok(worker.includes("cachedCompleteShell(request)"));
  assert.ok(worker.includes('if (url.pathname.startsWith("/api/")) return'));
});

test("client build identity includes package version and the build-time Vercel commit", () => {
  const client = fs.readFileSync(path.join(root, "app/release-update.tsx"), "utf8");
  const config = fs.readFileSync(path.join(root, "next.config.ts"), "utf8");
  assert.ok(client.includes('import { version } from "@/package.json"'));
  assert.ok(client.includes("process.env.NEXT_PUBLIC_PB_BUILD_COMMIT"));
  assert.ok(config.includes("NEXT_PUBLIC_PB_BUILD_COMMIT: process.env.VERCEL_GIT_COMMIT_SHA"));
});
