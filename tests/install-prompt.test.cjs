const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const ts = require("typescript");
const vm = require("node:vm");
const source = fs.readFileSync(path.join(__dirname, "../app/workspace.tsx"), "utf8");
const ast = ts.createSourceFile("workspace.tsx", source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
let installEffect;
let installFunction;
function visit(node) {
  if (ts.isCallExpression(node) && node.expression.getText(ast) === "useEffect" && node.arguments[0]?.getText(ast).includes('const installedKey = "pakki-baat-installed"')) {
    installEffect = node.arguments[0].getText(ast);
  }
  if (ts.isFunctionDeclaration(node) && node.name?.text === "installPakkiBaat") installFunction = node.getText(ast);
  ts.forEachChild(node, visit);
}
visit(ast);
assert.ok(installEffect, "customer install effect exists");
assert.ok(installFunction, "customer install action exists");

function harness({ remembered = true, standalone = false, iosStandalone = false, deniedStorage = false } = {}) {
  const stored = new Map(remembered ? [["pakki-baat-installed", "1"]] : []);
  const listeners = new Map();
  const state = { installed: null, prompt: null, helpOpen: null, standalone, iosStandalone };
  const context = {
    window: {
      matchMedia: () => ({ matches: state.standalone }),
      navigator: { get standalone() { return state.iosStandalone; } },
      addEventListener: (name, callback) => listeners.set(name, callback),
      removeEventListener: name => listeners.delete(name),
    },
    localStorage: {
      getItem: key => stored.get(key),
      setItem: (key, value) => stored.set(key, value),
      removeItem: key => { if (deniedStorage) throw Error("Storage denied"); stored.delete(key); },
    },
    setAppInstalled: value => { state.installed = value; },
    setInstallPrompt: value => { state.prompt = value; },
    setInstallHelpOpen: value => { state.helpOpen = value; },
    setInstallWelcomeOpen() {},
    setToast() {},
  };
  const output = ts.transpileModule("(" + installEffect + ")()", { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText;
  const cleanup = vm.runInNewContext(output, context);
  const prompt = { preventDefault() { state.prevented = true; } };
  return { state, stored, listeners, cleanup, prompt };
}

test("a new install prompt clears stale installation memory and exposes the Settings card", () => {
  const h = harness();
  assert.equal(h.state.installed, true);
  h.listeners.get("beforeinstallprompt")(h.prompt);
  assert.equal(h.state.prevented, true);
  assert.equal(h.stored.has("pakki-baat-installed"), false);
  assert.equal(h.state.installed, false);
  assert.equal(h.state.prompt, h.prompt);
  h.listeners.get("appinstalled")();
  assert.equal(h.state.installed, true);
  assert.equal(h.stored.get("pakki-baat-installed"), "1");
  assert.equal(h.state.prompt, null);
  assert.equal(h.state.helpOpen, false);
  h.cleanup();
  assert.equal(h.listeners.size, 0);
});

test("fresh prompts preserve standalone hiding, including standalone entered after mount", () => {
  for (const options of [{ standalone: true }, { iosStandalone: true }, {}]) {
    const h = harness(options);
    if (!options.standalone && !options.iosStandalone) h.state.standalone = true;
    h.listeners.get("beforeinstallprompt")(h.prompt);
    assert.equal(h.state.installed, true);
    assert.equal(h.state.prompt, null);
    assert.equal(h.stored.get("pakki-baat-installed"), "1");
  }
});

test("storage denial does not prevent an available install prompt from showing", () => {
  const h = harness({ deniedStorage: true });
  assert.doesNotThrow(() => h.listeners.get("beforeinstallprompt")(h.prompt));
  assert.equal(h.state.installed, false);
  assert.equal(h.state.prompt, h.prompt);
});

async function runInstall({ installed = false, prompt = null } = {}) {
  const state = { helpOpen: false, prompt, prompted: 0, toast: "" };
  const context = {
    appInstalled: installed,
    installPrompt: prompt,
    setInstallPrompt: value => { state.prompt = value; },
    setInstallHelpOpen: value => { state.helpOpen = value; },
    setToast: value => { state.toast = value; },
  };
  vm.createContext(context);
  vm.runInContext(ts.transpileModule(installFunction, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText, context);
  await context.installPakkiBaat();
  return state;
}

test("install entries use the existing prompt and hide behind installed state", async () => {
  for (const className of ["top-menu-install-entry", "settings-install-entry"]) {
    const entry = new RegExp(`!appInstalled && \\(\\s*<button[\\s\\S]{0,300}className="${className}"`).exec(source);
    assert.ok(entry, className);
  }
  const prompt = {
    prompt() { this.calls = (this.calls || 0) + 1; return Promise.resolve(); },
    userChoice: Promise.resolve({ outcome: "accepted" }),
  };
  const prompted = await runInstall({ prompt });
  assert.equal(prompt.calls, 1);
  assert.equal(prompted.prompt, null);
  assert.equal(prompted.helpOpen, false);
  const installed = await runInstall({ installed: true });
  assert.match(installed.toast, /already installed/);
});

test("missing browser prompt opens concise Android and iPhone install help", async () => {
  const fallback = await runInstall();
  assert.equal(fallback.helpOpen, true);
  assert.match(source, /installHelpOpen && !appInstalled/);
  for (const instruction of ["Android Chrome", "menu &gt; Install app", "iPhone Safari", "Share &gt; Add to Home Screen"]) {
    assert.ok(source.includes(instruction), instruction);
  }
});
