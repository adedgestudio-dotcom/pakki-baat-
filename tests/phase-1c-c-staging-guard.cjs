/* eslint-disable @typescript-eslint/no-require-imports */
// Read-only prerequisite gate for Phase 1C-C. Never loads .env.local or writes data.
const fs = require("node:fs");
const path = require("node:path");

const STAGING_REF = "jplxtqiryjnsdruqxgbh";
const PRODUCTION_REF = "uendrvpkyvfxnoxsalpu";
const required = [
  "STAGING_SUPABASE_URL",
  "STAGING_ANON_KEY",
  "STAGING_SERVICE_ROLE_KEY",
  "STAGING_TEST_EMAIL",
  "STAGING_TEST_PASSWORD",
];

function stagingConfig() {
  const file = path.join(__dirname, "../.env.staging.local");
  if (!fs.existsSync(file)) return {};
  const values = {};
  for (const line of fs.readFileSync(file, "utf8").split(/\r?\n/)) {
    if (!line.trim() || line.trimStart().startsWith("#")) continue;
    const divider = line.indexOf("=");
    const name = line.slice(0, divider).trim();
    if (divider < 1 || !required.includes(name) || Object.hasOwn(values, name))
      throw new Error("Staging configuration has an unknown or duplicate field.");
    values[name] = line.slice(divider + 1).trim();
  }
  return values;
}

function projectRef(url) {
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== "https:" || parsed.pathname !== "/" || parsed.search || parsed.hash) return null;
    const match = /^([a-z0-9]{20})\.supabase\.co$/.exec(parsed.hostname);
    return match?.[1] || null;
  } catch { return null; }
}

function jwtRef(key) {
  const parts = key.split(".");
  if (parts.length !== 3) return null; // Newer Supabase keys can be opaque.
  try { return JSON.parse(Buffer.from(parts[1], "base64url").toString("utf8")).ref || null; }
  catch { return null; }
}

function localAppRef() {
  const file = path.join(__dirname, "../.env.local");
  if (!fs.existsSync(file)) return null;
  const line = fs.readFileSync(file, "utf8").split(/\r?\n/).find((part) => /^\s*NEXT_PUBLIC_SUPABASE_URL\s*=/.test(part));
  return line ? projectRef(line.split("=").slice(1).join("=").trim().replace(/^['"]|['"]$/g, "")) : null;
}

async function probe(url, anonKey, serviceKey, email, password) {
  const settings = await fetch(url + "/auth/v1/settings", { headers: { apikey: anonKey }, signal: AbortSignal.timeout(10000) });
  if (!settings.ok) throw new Error("Staging anon key was not accepted by the staging Auth endpoint.");
  const service = await fetch(url + "/rest/v1/workspaces?select=owner_id&limit=0", {
    headers: { apikey: serviceKey, Authorization: "Bearer " + serviceKey }, signal: AbortSignal.timeout(10000),
  });
  if (!service.ok) throw new Error("Staging service-role key was not accepted for a zero-row read.");
  const login = await fetch(url + "/auth/v1/token?grant_type=password", {
    method: "POST", headers: { apikey: anonKey, "Content-Type": "application/json" },
    body: JSON.stringify({ email, password }), signal: AbortSignal.timeout(10000),
  });
  if (!login.ok) throw new Error("Fictional staging account login failed.");
  const session = await login.json();
  if (session.user?.email?.toLowerCase() !== email.toLowerCase() || !/^[0-9a-f-]{36}$/i.test(session.user?.id || ""))
    throw new Error("Authenticated staging identity did not match the requested fictional account.");
  const mode = await fetch(url + "/rest/v1/workspace_ledger_modes?select=enabled", {
    headers: { apikey: anonKey, Authorization: "Bearer " + session.access_token }, signal: AbortSignal.timeout(10000),
  });
  if (!mode.ok) throw new Error("Could not read the fictional account's ledger mode under its own token.");
  const modes = await mode.json();
  console.log("STAGING API: VERIFIED");
  console.log("FICTIONAL AUTH ACCOUNT: VERIFIED");
  console.log("LEDGER MODE: " + (modes[0]?.enabled ? "ON — stop and investigate" : "OFF"));
  if (modes[0]?.enabled) process.exitCode = 1;
}

async function main() {
  const localRef = localAppRef();
  console.log("LOCAL .env.local TARGET: " + (localRef === PRODUCTION_REF ? "PRODUCTION — do not run the app for staging tests" : localRef === STAGING_REF ? "STAGING" : "UNVERIFIED"));
  const config = stagingConfig();
  const missing = required.filter((name) => !config[name]);
  if (missing.length) {
    console.log("STAGING PREREQUISITES MISSING: " + missing.join(", "));
    process.exitCode = 2;
    return;
  }
  const url = config.STAGING_SUPABASE_URL.replace(/\/$/, "");
  const ref = projectRef(url + "/");
  if (ref !== STAGING_REF || ref === PRODUCTION_REF) throw new Error("Refusing non-staging Supabase URL.");
  for (const name of ["STAGING_ANON_KEY", "STAGING_SERVICE_ROLE_KEY"]) {
    const claim = jwtRef(config[name]);
    if (claim && claim !== STAGING_REF) throw new Error("Refusing a key whose project claim is not staging: " + name);
  }
  const email = config.STAGING_TEST_EMAIL.trim().toLowerCase();
  if (!/^ledger-staging-[a-z0-9._-]+@/.test(email)) throw new Error("Use a dedicated fictional account named ledger-staging-… before testing.");
  console.log("EXPLICIT PROJECT TARGET: VERIFIED STAGING");
  console.log("TEST ACCOUNT LABEL: FICTIONAL STAGING");
  if (!process.argv.includes("--probe")) {
    console.log("NETWORK PROBE: NOT RUN (pass --probe after supplying staging-only credentials)");
    return;
  }
  await probe(url, config.STAGING_ANON_KEY, config.STAGING_SERVICE_ROLE_KEY, email, config.STAGING_TEST_PASSWORD);
}

main().catch((error) => { console.error("STAGING GUARD FAILED: " + error.message); process.exitCode = 1; });
