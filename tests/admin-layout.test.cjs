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
  assert.ok(!source.includes('aria-label="Open app"'));
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

function loadTs(relativePath, mocks = {}, globals = {}) {
  const source = fs.readFileSync(path.join(__dirname, relativePath), "utf8");
  const output = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX } }).outputText;
  const exports = {};
  vm.runInNewContext(output, { ...globals, exports, Response, require: name => {
    if (name in mocks) return mocks[name];
    throw new Error("Unexpected import: " + name);
  } });
  return exports;
}

test("zero pending counts hide both badges and the header uses the owner constant and real logo", () => {
  assert.equal((source.match(/pendingCount>0&&<span className="admin-badge">\{pendingCount\}<\/span>/g) || []).length, 2);
  assert.equal((source.match(/<span className="admin-badge">/g) || []).length, 2);
  assert.match(source, /aria-label=\{`Pending payments: \$\{pendingCount\}`\}[\s\S]*?pendingCount>0&&<span className="admin-badge">\{pendingCount\}/);
  assert.match(source, /item==="payments"&&pendingCount>0&&<span className="admin-badge">\{pendingCount\}/);
  assert.match(source, /const ADMIN_NAME="Sarrah Bharmal"/);
  assert.equal((source.match(/Sarrah Bharmal/g) || []).length, 1);
  assert.match(source, /<small>\{ADMIN_NAME\} · Admin<\/small>/);
  assert.match(source, /<img className="admin-brand-logo" src="\/admin-icon.svg" width="36" height="36" alt="Pakki Baat"\/>/);
});

test("signup dismissal persists only dismissed IDs and caps the oldest at 500", () => {
  const seen = loadTs("../app/admin/seen-users.ts");
  const values = new Map();
  const storage = { getItem: key => values.get(key) ?? null, setItem: (key, value) => values.set(key, value) };
  let ids = seen.readSeenUsers(storage);
  assert.equal(ids.length, 0); assert.equal(values.size, 0);
  ids = seen.dismissNewUser(storage, ids, 'first');
  assert.deepEqual(Array.from(seen.readSeenUsers(storage)), ['first']);
  for (let i = 0; i < 500; i++) ids = seen.dismissNewUser(storage, ids, `user-${i}`);
  assert.equal(ids.length, 500); assert.equal(ids.includes('first'), false);
  assert.equal(seen.readSeenUsers(storage).length, 500);
  assert.equal(seen.readSeenUsers(storage).at(-1), 'user-499');
  assert.match(source, /seenUsers&&!seenUsers\.includes\(u\.id\)/);
  assert.match(source, /onClick=\{\(\)=>dismissSignup\(u\.id\)\}/);
  assert.match(source, /aria-label="Install app"/);
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
  assert.deepEqual(manifest.icons, [
    { src: "/admin-icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
    { src: "/admin-icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
    { src: "/admin-icon-maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    { src: "/admin-icon.svg", sizes: "any", type: "image/svg+xml", purpose: "any" },
  ]);
  const { metadata } = loadTs("../app/admin/layout.tsx", { "react/jsx-runtime": {} });
  assert.equal(metadata.manifest, "/admin/manifest.webmanifest");
  assert.equal(metadata.appleWebApp.title, "PB Admin");
  assert.equal(metadata.icons.apple, "/admin-icon-192.png");
  assert.equal(metadata.icons.icon, "/admin-icon.svg");
});

test("admin install controls require browser support and hide in standalone mode", () => {
  const install = fs.readFileSync(path.join(__dirname, "../app/admin/use-admin-install.ts"), "utf8");
  assert.match(install, /addEventListener\("beforeinstallprompt", capturePrompt\)/);
  assert.match(install, /removeEventListener\("beforeinstallprompt", capturePrompt\)/);
  assert.match(install, /canInstall: !!prompt && !standalone && !isIosSafari/);
  assert.match(install, /isIosSafari: isIosSafari && !standalone/);
  assert.match(install, /showInstallFallback: !prompt && !standalone && !isIosSafari/);
  assert.match(install, /window.matchMedia\("\(display-mode: standalone\)"\)/);
  assert.match(source, /canInstall&&<button[^>]*onClick=\{\(\)=>void install\(\)\}/);
  assert.match(source, /isIosSafari&&<p>Tap Share, then Add to Home Screen<\/p>/);
  assert.ok(source.includes("{showInstallFallback&&<p>To install: browser menu, then Install app (Chrome) or Add to Home Screen.</p>}"));
});

test("four admin tabs fit in the phone navigation", () => {
  const css = fs.readFileSync(path.join(__dirname, "../app/admin/admin.css"), "utf8");
  assert.match(source, /\["home","payments","users","alerts"\]/);
  assert.match(css, /\.admin-tabs\{[^}]*grid-template-columns:repeat\(4,minmax\(0,1fr\)\)/);
});

test("admin worker version changes trigger registration and an explicit update check", async () => {
  const worker = fs.readFileSync(path.join(__dirname, "../public/admin-sw.js"), "utf8");
  const install = fs.readFileSync(path.join(__dirname, "../app/admin/use-admin-install.ts"), "utf8");
  assert.match(worker, /ADMIN_WORKER_VERSION = "pakki-baat-admin-20261117-1"/);
  assert.match(worker, /self\.skipWaiting\(\)/);
  assert.match(worker, /self\.clients\.claim\(\)/);
  assert.match(worker, /fetch\(event.request, \{ cache: "no-store" \}\)/);
  assert.match(install, /register\("\/admin-sw\.js", \{ scope: "\/admin", updateViaCache: "none" \}\)\.then\(registration => registration\.update\(\)\)/);
  const listeners = new Map();
  vm.runInNewContext(worker, { self: { location: { origin: 'https://test.invalid' }, addEventListener: (name, handler) => listeners.set(name, handler), skipWaiting: async () => {}, clients: { claim: async () => {} } }, URL, fetch: async (request, options) => ({ request, options }) });
  let response;
  listeners.get('fetch')({ request: { url: 'https://test.invalid/admin', method: 'GET', mode: 'navigate' }, respondWith(value) { response = value; } });
  assert.equal((await response).options.cache, 'no-store');
});

test("opening admin registers its worker and checks for an update", async () => {
  const effects = [], calls = [];
  const react = { useState: value => [value, () => {}], useRef: value => ({ current: value }), useEffect: fn => effects.push(fn) };
  const display = { matches: false, addEventListener() {}, removeEventListener() {} };
  const window = { matchMedia: () => display, addEventListener() {}, removeEventListener() {} };
  const navigator = { userAgent: 'Chrome', serviceWorker: { register: async (url, options) => { calls.push([url, options.scope, options.updateViaCache]); return { update: async () => { calls.push('update'); } }; } } };
  const { useAdminInstall } = loadTs('../app/admin/use-admin-install.ts', { react }, { window, navigator });
  useAdminInstall(); const cleanup = effects[0]();
  await new Promise(resolve => setImmediate(resolve));
  assert.deepEqual(calls, [['/admin-sw.js', '/admin', 'none'], 'update']);
  cleanup();
});

test("admin install capture retains an early event and the hook consumes it once", async () => {
  const layout = fs.readFileSync(path.join(__dirname, "../app/admin/layout.tsx"), "utf8");
  const capture = layout.match(/__html: `([\s\S]*?)`/)[1];
  const listeners = new Map();
  const window = {
    addEventListener(name, fn) { if (!listeners.has(name)) listeners.set(name, new Set()); listeners.get(name).add(fn); },
    removeEventListener(name, fn) { listeners.get(name)?.delete(fn); },
    dispatchEvent(event) { for (const fn of listeners.get(event.type) || []) fn(event); },
    matchMedia() { return { matches: false, addEventListener() {}, removeEventListener() {} }; },
  };
  const location = { pathname: "/admin" };
  const Event = class { constructor(type) { this.type = type; } };
  vm.runInNewContext(capture, { window, location, Event });
  let prompted = 0;
  const early = { type: "beforeinstallprompt", preventDefault() {}, prompt: async () => { prompted++; }, userChoice: Promise.resolve({ outcome: "dismissed" }) };
  window.dispatchEvent(early);
  assert.equal(window.__pbAdminInstallPrompt, early);

  const slots = [];
  const effects = [];
  let cursor = 0;
  let mounted = false;
  const react = {
    useState(initial) { const i = cursor++; if (!(i in slots)) slots[i] = initial; return [slots[i], value => { slots[i] = value; }]; },
    useRef(initial) { const i = cursor++; return slots[i] ||= { current: initial }; },
    useEffect(fn) { if (!mounted) effects.push(fn); },
  };
  const { useAdminInstall } = loadTs("../app/admin/use-admin-install.ts", { react }, { window, navigator: { userAgent: "Chrome" } });
  const render = () => { cursor = 0; return useAdminInstall(); };
  render();
  const cleanup = effects[0]();
  mounted = true;
  assert.equal(render().canInstall, true);
  assert.equal(render().showInstallFallback, false);
  await render().install();
  assert.equal(prompted, 1);
  assert.equal(window.__pbAdminInstallPrompt, null);
  assert.equal(render().showInstallFallback, true);
  window.dispatchEvent(early);
  assert.equal(render().canInstall, true);
  window.dispatchEvent({ type: "appinstalled" });
  assert.equal(window.__pbAdminInstallPrompt, null);
  assert.equal(render().canInstall, false);
  assert.equal(render().showInstallFallback, false);
  cleanup();
  assert.equal(listeners.get("pb-admin-install-ready").size, 0);
  location.pathname = "/";
  window.dispatchEvent(early);
  assert.equal(window.__pbAdminInstallPrompt, null);
});
