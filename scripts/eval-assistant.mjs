#!/usr/bin/env node
// Measures how well the typed AI assistant extracts entries, with no chat state.
//
// The prompt, the spoken-amount conversion and the amount fallback are NOT
// copied here. At run time this script parses app/api/process-message/route.ts
// with the TypeScript AST and runs the route's own statements:
//   - the model default (DEFAULT_GROQ_MODEL / groqModel)
//   - everything from `const currentCommitment` to `const userPrompt`
//     (system prompt, normalizeSpokenAmounts call, user prompt)
//   - the Groq URL and request body from the route's fetch call
//   - the whole commitment branch (amount fallback, merge, derived values)
// lib/spoken-amounts.ts is transpiled the same way tests/spoken-amounts.test.cjs does.
// If the route changes shape so a piece cannot be found, the script stops.
//
// Calls Groq directly: no Supabase, no metering. GROQ_API_KEY comes from the
// environment only and is never printed.
//
// Usage: node scripts/eval-assistant.mjs [--model <name>] [--runs 3]

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import vm from "node:vm";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const ts = require("typescript");

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const ROUTE_FILE = path.join(ROOT, "app/api/process-message/route.ts");
const SPOKEN_FILE = path.join(ROOT, "lib/spoken-amounts.ts");

const CASES = [
  { text: "Asha ne 5 kg cake order kiya 750 per kg, 100 advance diya", expect: { customer: "Asha", total: 3750, paid: 100 } },
  { text: "2 kg barfi 600 per kg for Meena", expect: { customer: "Meena", total: 1200 } },
  { text: "Raju ka 3 dozen ladoo 200 per dozen, 100 advance", expect: { customer: "Raju", total: 600, paid: 100 } },
  { text: "Ravi ne 500 ka kaam diya", expect: { customer: "Ravi", total: 500 } },
  { text: "Asha ne brownie ka order diya 200 rupaye", expect: { customer: "Asha", workContains: "brownie", total: 200 } },
  { text: "Sunita ka cake, do hazaar total, paanch sau advance", expect: { customer: "Sunita", total: 2000, paid: 500 } },
  { text: "Imran bhai ka 1500 baki hai", expect: { customer: "Imran", balance: 1500 } },
  { text: "Raju ka 2 kg cake, ek hazaar do sau", expect: { customer: "Raju", total: 1200 } },
  { text: "Kavita ne ₹१५०० advance diya, total teen hazaar", expect: { customer: "Kavita", total: 3000, paid: 1500 } },
  { text: "Arjun ka order 2 lakh ka hai", expect: { customer: "Arjun", total: 200000 } },
  { text: "Pooja ko 2l doodh chahiye, 200 rupaye", expect: { customer: "Pooja", total: 200 } },
  { text: "Sameer, teen dozen ladoo, 600 rupaye, do sau diye", expect: { customer: "Sameer", total: 600, paid: 200 } },
  { text: "रवि ने 500 का काम दिया", expect: { customer: "Ravi", total: 500 } },
  { text: "Meena ka dhai hazaar ka order, baki 1000", expect: { customer: "Meena", total: 2500, balance: 1000 } },
  { text: "Ravi gave 500 rs advance for a 2000 rs order", expect: { customer: "Ravi", total: 2000, paid: 500 } },
];

// ---------- arguments ----------
function parseArgs(argv) {
  const out = { model: undefined, runs: 3 };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--model") out.model = argv[++i];
    else if (arg.startsWith("--model=")) out.model = arg.slice(8);
    else if (arg === "--runs") out.runs = Number(argv[++i]);
    else if (arg.startsWith("--runs=")) out.runs = Number(arg.slice(7));
    else if (arg === "--help" || arg === "-h") {
      console.log("Usage: node scripts/eval-assistant.mjs [--model <name>] [--runs 3]");
      process.exit(0);
    } else throw new Error(`Unknown argument: ${arg}`);
  }
  if (out.model !== undefined && !out.model.trim()) throw new Error("--model needs a name");
  if (!Number.isInteger(out.runs) || out.runs < 1) throw new Error("--runs must be a positive integer");
  return out;
}

// ---------- extraction from route.ts ----------
function transpile(code) {
  return ts.transpileModule(code, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
    reportDiagnostics: false,
  }).outputText;
}

function shapeError(what) {
  return new Error(`Could not find ${what} in app/api/process-message/route.ts. The route changed shape; update scripts/eval-assistant.mjs.`);
}

function declaresName(stmt, name) {
  return ts.isVariableStatement(stmt) &&
    stmt.declarationList.declarations.some(d => ts.isIdentifier(d.name) && d.name.text === name);
}

function findDeep(node, predicate) {
  let found;
  (function visit(n) {
    if (found) return;
    if (predicate(n)) { found = n; return; }
    ts.forEachChild(n, visit);
  })(node);
  return found;
}

function loadSpokenAmounts() {
  const mod = { exports: {} };
  vm.runInNewContext(transpile(fs.readFileSync(SPOKEN_FILE, "utf8")), { module: mod, exports: mod.exports });
  if (typeof mod.exports.normalizeSpokenAmounts !== "function") throw new Error("normalizeSpokenAmounts not exported from lib/spoken-amounts.ts");
  return mod.exports.normalizeSpokenAmounts;
}

function loadRoute() {
  const source = fs.readFileSync(ROUTE_FILE, "utf8");
  const sf = ts.createSourceFile(ROUTE_FILE, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  const text = node => source.slice(node.getStart(sf), node.end);
  const normalizeSpokenAmounts = loadSpokenAmounts();
  const quietConsole = { log() {}, info() {}, warn() {}, error() {} };

  // 1. Model default: DEFAULT_GROQ_MODEL, DEPRECATED_GROQ_MODELS, groqModel().
  const top = sf.statements;
  const defaultStmt = top.find(s => declaresName(s, "DEFAULT_GROQ_MODEL"));
  const deprecatedStmt = top.find(s => declaresName(s, "DEPRECATED_GROQ_MODELS"));
  const groqModelFn = top.find(s => ts.isFunctionDeclaration(s) && s.name?.text === "groqModel");
  if (!defaultStmt || !deprecatedStmt || !groqModelFn) throw shapeError("the model default (DEFAULT_GROQ_MODEL / groqModel)");
  const routeModel = vm.runInNewContext(
    transpile(`${text(defaultStmt)}\n${text(deprecatedStmt)}\n${text(groqModelFn)}\ngroqModel();`),
    // Only the model variable is handed over; the key never enters this context.
    { process: { env: { GROQ_EXTRACTION_MODEL: process.env.GROQ_EXTRACTION_MODEL } } }
  );

  // 2. POST body statements.
  const post = top.find(s => ts.isFunctionDeclaration(s) && s.name?.text === "POST");
  const tryStmt = post?.body?.statements.find(ts.isTryStatement);
  if (!tryStmt) throw shapeError("POST's try block");
  const body = tryStmt.tryBlock.statements;

  // 3. Prompt building: from `const currentCommitment` through `const userPrompt`.
  const startIdx = body.findIndex(s => declaresName(s, "currentCommitment"));
  const endIdx = body.findIndex(s => declaresName(s, "userPrompt"));
  if (startIdx < 0 || endIdx < startIdx) throw shapeError("the prompt statements (currentCommitment ... userPrompt)");
  if (!body.slice(startIdx, endIdx + 1).some(s => declaresName(s, "normalizedMessage"))) throw shapeError("const normalizedMessage");
  const promptSlice = source.slice(body[startIdx].getStart(sf), body[endIdx].end);
  const buildPrompts = vm.runInNewContext(
    transpile(`(function (pending, today, customerContext, message) {\n${promptSlice}\nreturn { systemPrompt, userPrompt, normalizedMessage, currentCommitment };\n})`),
    { normalizeSpokenAmounts, console: quietConsole }
  );

  // 4. Groq URL and request body from the route's fetch call.
  const responseStmt = body.find(s => declaresName(s, "response"));
  const fetchCall = responseStmt && findDeep(responseStmt, n => ts.isCallExpression(n) && ts.isIdentifier(n.expression) && n.expression.text === "fetch");
  const urlArg = fetchCall?.arguments[0];
  const initArg = fetchCall?.arguments[1];
  if (!urlArg || !ts.isStringLiteralLike(urlArg) || !initArg || !ts.isObjectLiteralExpression(initArg)) throw shapeError("the Groq fetch call");
  const bodyProp = initArg.properties.find(p => ts.isPropertyAssignment(p) && p.name.getText(sf) === "body");
  const stringifyCall = bodyProp && bodyProp.initializer;
  if (!stringifyCall || !ts.isCallExpression(stringifyCall) || stringifyCall.expression.getText(sf) !== "JSON.stringify") throw shapeError("the fetch body JSON.stringify(...)");
  const buildRequestBody = vm.runInNewContext(
    transpile(`(function (MODEL, systemPrompt, userPrompt) { return (${text(stringifyCall.arguments[0])}); })`),
    {}
  );

  // 5. The commitment branch: amount fallback, merge and derived values.
  const commitmentIf = body.find(s => ts.isIfStatement(s) && /parsed\.intent\s*===\s*"commitment"/.test(text(s.expression)));
  if (!commitmentIf || !ts.isBlock(commitmentIf.thenStatement)) throw shapeError('the `parsed.intent === "commitment"` branch');
  const NextResponse = { json: (value, init) => ({ value, init }) };
  const runCommitment = vm.runInNewContext(
    transpile(`(function (parsed, message, normalizedMessage, currentCommitment) ${text(commitmentIf.thenStatement)})`),
    { NextResponse, console: quietConsole }
  );

  return {
    routeModel,
    groqUrl: urlArg.text,
    buildPrompts,
    buildRequestBody,
    runCommitment,
    routeSha256: crypto.createHash("sha256").update(source).digest("hex"),
  };
}

// ---------- Groq ----------
const sleep = ms => new Promise(r => setTimeout(r, ms));

function redact(textValue, key) {
  return key ? String(textValue).split(key).join("[redacted]") : String(textValue);
}

async function callGroq(route, apiKey, model, systemPrompt, userPrompt) {
  const requestBody = JSON.stringify(route.buildRequestBody(model, systemPrompt, userPrompt));
  for (let attempt = 1; ; attempt++) {
    let res;
    try {
      res = await fetch(route.groqUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
        body: requestBody,
        signal: AbortSignal.timeout(60_000),
      });
    } catch (err) {
      if (attempt < 4) { await sleep(2000 * attempt); continue; }
      throw new Error(redact(`network error: ${err?.message || err}`, apiKey));
    }
    if (res.ok) {
      const result = await res.json();
      const content = result.choices?.[0]?.message?.content;
      if (!content) throw new Error("No response from Groq");
      return JSON.parse(content); // same as the route
    }
    const upstream = await res.text();
    if ((res.status === 429 || res.status >= 500) && attempt < 4) {
      const retryAfter = Number(res.headers.get("retry-after"));
      await sleep(Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter * 1000 : 3000 * attempt);
      continue;
    }
    let message = `Groq API error: ${res.status}`;
    try { message = JSON.parse(upstream)?.error?.message || message; } catch {}
    throw new Error(redact(message, apiKey));
  }
}

// ---------- scoring ----------
const norm = v => String(v ?? "").trim().toLowerCase();

function score(expect, got) {
  const reasons = [];
  if (norm(got.customer) !== norm(expect.customer)) reasons.push("customer");
  if (expect.workContains && !norm(got.work).includes(norm(expect.workContains))) reasons.push("work");
  for (const field of ["total", "paid", "balance"]) {
    if (expect[field] !== undefined && Number(got[field]) !== expect[field]) reasons.push(field);
  }
  return reasons;
}

function describeExpected(e) {
  return [
    `customer=${e.customer}`,
    e.workContains && `work~${e.workContains}`,
    e.total !== undefined && `total=${e.total}`,
    e.paid !== undefined && `paid=${e.paid}`,
    e.balance !== undefined && `balance=${e.balance}`,
  ].filter(Boolean).join(" ");
}

function describeGot(run) {
  if (run.error) return `ERROR: ${run.error}`;
  if (run.intent !== "commitment") return `intent=${run.intent}`;
  const g = run.got;
  return [
    `customer=${g.customer ?? "-"}`,
    g.work !== undefined && `work=${g.work}`,
    g.total !== undefined && `total=${g.total}`,
    g.paid !== undefined && `paid=${g.paid}`,
    g.balance !== undefined && `balance=${g.balance}`,
  ].filter(Boolean).join(" ");
}

const clip = (s, n) => (s.length > n ? s.slice(0, n - 1) + "…" : s).padEnd(n);

function localDate() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

// ---------- main ----------
async function main() {
  const args = parseArgs(process.argv.slice(2));
  const apiKey = (process.env.GROQ_API_KEY || "").trim();
  if (!apiKey) {
    console.error("GROQ_API_KEY is not set in the environment.");
    process.exit(2);
  }

  const route = loadRoute();
  const model = args.model?.trim() || route.routeModel;
  const today = localDate();
  console.log(`Model: ${model}   Runs per sentence: ${args.runs}   Today: ${today}`);
  console.log(`Route: app/api/process-message/route.ts (sha256 ${route.routeSha256.slice(0, 12)})\n`);

  const W = { n: 3, run: 3, sentence: 42, expected: 40, got: 58, result: 6 };
  const header = `${"#".padEnd(W.n)} ${"run".padEnd(W.run)} ${"sentence".padEnd(W.sentence)} ${"expected".padEnd(W.expected)} ${"got".padEnd(W.got)} ${"result".padEnd(W.result)}`;
  console.log(header);
  console.log("-".repeat(header.length));

  const results = [];
  let totalPass = 0;
  let totalRuns = 0;

  for (const [i, c] of CASES.entries()) {
    const runs = [];
    for (let r = 1; r <= args.runs; r++) {
      const run = { run: r };
      try {
        // No chat state: empty pending, no customer context.
        const { systemPrompt, userPrompt, normalizedMessage, currentCommitment } = route.buildPrompts({}, today, undefined, c.text);
        run.normalizedMessage = normalizedMessage;
        const parsed = await callGroq(route, apiKey, model, systemPrompt, userPrompt);
        run.raw = JSON.parse(JSON.stringify(parsed));
        run.intent = parsed.intent || "commitment";
        if (!parsed.intent || parsed.intent === "commitment") {
          const out = route.runCommitment(parsed, c.text, normalizedMessage, currentCommitment);
          run.got = JSON.parse(JSON.stringify(out.value.updated || {}));
          run.nextQuestion = out.value.nextQuestion ?? null;
          run.failed = score(c.expect, run.got);
        } else {
          run.failed = ["intent"];
        }
      } catch (err) {
        run.error = redact(err?.message || err, apiKey);
        run.failed = ["error"];
      }
      run.pass = run.failed.length === 0;
      runs.push(run);
      totalRuns++;
      if (run.pass) totalPass++;
      console.log(
        `${String(i + 1).padEnd(W.n)} ${String(r).padEnd(W.run)} ${clip(c.text, W.sentence)} ${clip(describeExpected(c.expect), W.expected)} ${clip(describeGot(run), W.got)} ${run.pass ? "PASS" : "FAIL " + run.failed.join(",")}`
      );
    }
    const passed = runs.filter(r => r.pass).length;
    console.log(`${"".padEnd(W.n)} ${"".padEnd(W.run)} pass rate: ${passed}/${runs.length} (${Math.round((passed / runs.length) * 100)}%)\n`);
    results.push({ index: i + 1, sentence: c.text, expected: c.expect, passed, runs: runs.length, passRate: passed / runs.length, results: runs });
  }

  const pct = totalRuns ? (totalPass / totalRuns) * 100 : 0;
  console.log(`TOTAL: ${totalPass}/${totalRuns} runs passed (${pct.toFixed(1)}%)`);
  const fullySolid = results.filter(r => r.passed === r.runs).length;
  console.log(`Sentences passing every run: ${fullySolid}/${results.length}`);

  const outDir = path.join(process.env.USERPROFILE || os.homedir(), "pakki-baat-backups", "eval");
  fs.mkdirSync(outDir, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const safeModel = model.replace(/[^a-zA-Z0-9._-]+/g, "_");
  const outFile = path.join(outDir, `eval-assistant-${stamp}-${safeModel}.json`);
  fs.writeFileSync(outFile, JSON.stringify({
    createdAt: new Date().toISOString(),
    model,
    runsPerSentence: args.runs,
    today,
    route: { file: "app/api/process-message/route.ts", sha256: route.routeSha256 },
    total: { passed: totalPass, runs: totalRuns, score: totalRuns ? totalPass / totalRuns : 0, sentencesPassingEveryRun: fullySolid },
    sentences: results,
  }, null, 2));
  console.log(`\nResults written to ${outFile}`);
}

main().catch(err => {
  const key = (process.env.GROQ_API_KEY || "").trim();
  console.error(redact(err?.stack || err?.message || err, key));
  process.exit(2);
});
