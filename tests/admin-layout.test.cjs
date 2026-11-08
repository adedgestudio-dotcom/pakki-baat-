const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const source = fs.readFileSync(path.join(__dirname, "../app/admin/page.tsx"), "utf8");

test("owner panel retains the existing action wiring", () => {
  assert.match(source, /onConfirm:\(\)=>act\(\{action:"review_payment",paymentId:p.id,decision:"approve"\}\)/);
  assert.match(source, /onConfirm:\(\)=>act\(\{action:"review_payment",paymentId:p.id,decision:"reject"\}\)/);
  assert.match(source, /aria-label="Refresh"[^>]*onClick=\{\(\)=>void refresh\(\)\}/);
  assert.match(source, /async function refresh\(\)[\s\S]*?await load\(\)/);
  assert.match(source, /aria-label="Lock"[^>]*onClick=\{logout\}/);
  assert.match(source, /onConfirm:\(\)=>void backfillTrials\(\)/);
  assert.match(source, /fetch\("\/api\/admin\/backfill-trial-emails",\{method:"POST"\}\)/);
  assert.match(source, /fetch\("\/api\/admin\/auth",\{method:"DELETE"\}\)/);
  assert.ok(!source.includes(String.raw`\n`), "no stray literal backslash-n text");
});

test("owner panel shares payment actions and prevents duplicate submissions", () => {
  assert.match(source, /const paymentActions=/);
  assert.match(source, /p.status==="pending"&&paymentActions\(p\)/);
  assert.match(source, /if\(!begin\(body.paymentId\|\|body.userId\|\|body.action\)\)return/);
  assert.match(source, /if\(!begin\("trial-backfill"\)\)return/);
  assert.match(source, /role="status"/);
  assert.match(source, /setTimeout\(\(\)=>setToast\(""\),3000\)/);
});

test("owner panel clears errors after six seconds and on every tab switch", () => {
  assert.match(source, /useEffect\(\(\)=>\{if\(!error\)return;const timer=setTimeout\(\(\)=>setError\(""\),6000\);return\(\)=>clearTimeout\(timer\)\},\[error\]\)/);
  assert.match(source, /function switchTab\(next:string\)\{setError\(""\);setTab\(next\)\}/);
  assert.match(source, /onClick=\{\(\)=>switchTab\("payments"\)\}/);
  assert.match(source, /onClick=\{\(\)=>switchTab\(item\)\}/);
});

test("payment cards and table prefer submitted_at and show full emails", () => {
  assert.equal((source.match(/date\(p.submitted_at\|\|p.created_at\)/g) || []).length, 2);
  assert.ok(!source.includes("date(p.created_at)"));
  assert.equal((source.match(/\{p.email\|\|p.owner_id\}/g) || []).length, 2);
  assert.ok(!source.includes("maskEmail(p.email)"));
  assert.match(source, /maskEmail\(payment\?\.email\)/);
  assert.match(source, /const emailFor=.*?maskEmail\(u.email\)/);
});
const ts = require("typescript");
const vm = require("node:vm");

function loadTs(relativePath, mocks = {}) {
  const source = fs.readFileSync(path.join(__dirname, relativePath), "utf8");
  const output = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX } }).outputText;
  const exports = {};
  vm.runInNewContext(output, { exports, Response, require: name => {
    if (name in mocks) return mocks[name];
    throw new Error("Unexpected import: " + name);
  } });
  return exports;
}

test("zero pending counts hide all three badges and the header uses the owner constant and real logo", () => {
  assert.equal((source.match(/pendingCount>0&&<span className="admin-badge">\{pendingCount\}<\/span>/g) || []).length, 3);
  assert.equal((source.match(/<span className="admin-badge">/g) || []).length, 3);
  assert.match(source, /const ADMIN_NAME="Sarrah Bharmal"/);
  assert.equal((source.match(/Sarrah Bharmal/g) || []).length, 1);
  assert.match(source, /<small>\{ADMIN_NAME\} · Admin<\/small>/);
  assert.match(source, /<img className="admin-brand-logo" src="\/icon.svg" width="36" height="36" alt="Pakki Baat"\/>/);
});

test("admin manifest has a separate identity, scope and existing icons", async () => {
  const { GET } = loadTs("../app/admin/manifest.webmanifest/route.ts");
  const response = GET();
  assert.equal(response.headers.get("Content-Type"), "application/manifest+json");
  const manifest = await response.json();
  assert.deepEqual({ ...manifest, icons: undefined }, {
    name: "Pakki Baat Admin", short_name: "PB Admin", id: "/admin",
    start_url: "/admin", scope: "/admin", display: "standalone",
    background_color: "#141a18", theme_color: "#2d7667", icons: undefined,
  });
  for (const icon of manifest.icons) {
    assert.ok(fs.existsSync(path.join(__dirname, "../public", icon.src)));
  }
  assert.ok(manifest.icons.some(icon => icon.sizes === "192x192" && icon.type === "image/png"));
  const { metadata } = loadTs("../app/admin/layout.tsx", { "react/jsx-runtime": {} });
  assert.equal(metadata.manifest, "/admin/manifest.webmanifest");
  assert.equal(metadata.appleWebApp.title, "PB Admin");
  assert.ok(metadata.icons.apple);
});

test("admin install controls require browser support and hide in standalone mode", () => {
  const install = fs.readFileSync(path.join(__dirname, "../app/admin/use-admin-install.ts"), "utf8");
  assert.match(install, /addEventListener\("beforeinstallprompt", capturePrompt\)/);
  assert.match(install, /removeEventListener\("beforeinstallprompt", capturePrompt\)/);
  assert.match(install, /canInstall: !!prompt && !standalone && !isIosSafari/);
  assert.match(install, /isIosSafari: isIosSafari && !standalone/);
  assert.match(install, /window.matchMedia\("\(display-mode: standalone\)"\)/);
  assert.match(source, /canInstall&&<button[^>]*onClick=\{\(\)=>void install\(\)\}/);
  assert.match(source, /isIosSafari&&<p>Tap Share, then Add to Home Screen<\/p>/);
});

test("service worker bypasses admin pages and admin API before caching", () => {
  const worker = fs.readFileSync(path.join(__dirname, "../public/sw.js"), "utf8");
  const listeners = {};
  vm.runInNewContext(worker, { self: { addEventListener: (name, listener) => { listeners[name] = listener; }, location: { origin: "https://example.test" } }, URL });
  for (const pathname of ["/admin", "/admin/", "/admin/login", "/admin/manifest.webmanifest", "/api/admin/dashboard", "/api/admin/auth"]) {
    let intercepted = false;
    listeners.fetch({ request: { method: "GET", mode: "navigate", url: "https://example.test" + pathname }, respondWith: () => { intercepted = true; } });
    assert.equal(intercepted, false, pathname + " must use the network directly");
  }
});
