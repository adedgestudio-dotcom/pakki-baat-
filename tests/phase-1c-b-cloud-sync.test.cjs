/* eslint-disable @typescript-eslint/no-require-imports */
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");
const path = require("node:path");
const ts = require("typescript");

const source = fs.readFileSync(path.join(__dirname, "../lib/cloud.ts"), "utf8");
const compiled = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText;

function snapshot(jobs = [], payments = []) {
  return { jobs, payments, owner: "Fictional Owner", business: "Fictional Shop", reminders: [], notes: [], customerPhones: {} };
}

function harness({ mode = true, initial = snapshot(), revision = 1, storage = new Map() } = {}) {
  const requests = [];
  const state = { owner: "fictional-a", payload: initial, revision, rpc: null, switchDuringBackups: false };
  const auth = { getSession: async () => ({ data: { session: state.owner ? { user: { id: state.owner }, access_token: state.owner + "-token" } : null }, error: null }) };
  const ok = (data) => ({ ok: true, status: 200, text: async () => JSON.stringify(data) });
  const fail = (status, message, code) => ({ ok: false, status, text: async () => JSON.stringify({ message, code }) });
  async function fetch(url, options = {}) {
    const endpoint = new URL(url).pathname + new URL(url).search;
    const body = options.body ? JSON.parse(options.body) : null;
    requests.push({ endpoint, body, token: options.headers?.Authorization });
    if (endpoint.includes("workspace_ledger_modes")) {
      if (mode === "missing") return fail(404, "Could not find the table 'public.workspace_ledger_modes' in the schema cache", "PGRST205");
      if (mode === "denied") return fail(403, "permission denied", "42501");
      return ok(mode ? [{ enabled: true }] : []);
    }
    if (endpoint.startsWith("/rest/v1/workspaces?")) {
      return ok([{ payload: state.payload, revision: state.revision }]);
    }
    if (endpoint.startsWith("/rest/v1/workspace_backups?")) {
      if (state.switchDuringBackups) state.owner = "fictional-b";
      return ok([{ id: "fictional-backup", payload: state.payload, backup_kind: "daily" }]);
    }
    if (endpoint.endsWith("/rpc/save_workspace")) {
      state.payload = body.payload;
      return ok(null);
    }
    if (endpoint.endsWith("/rpc/save_workspace_with_ledger")) {
      if (state.rpc) return state.rpc(body);
      if (body.expected_revision !== state.revision && JSON.stringify(body.payload) !== JSON.stringify(state.payload))
        return fail(400, "WORKSPACE_REVISION_CONFLICT", "P0001");
      if (JSON.stringify(body.payload) !== JSON.stringify(state.payload)) {
        state.payload = body.payload;
        state.revision++;
      }
      return ok({ revision: state.revision, ledger_events: 1, unchanged: false });
    }
    throw new Error("Unexpected request " + endpoint);
  }
  const cloudModule = { exports: {} };
  vm.runInNewContext(compiled, {
    module: cloudModule, exports: cloudModule.exports, process: { env: { NEXT_PUBLIC_SUPABASE_URL: "https://staging.invalid", NEXT_PUBLIC_SUPABASE_ANON_KEY: "fictional-anon" } },
    require: (name) => {
      if (name === "@supabase/supabase-js") return { createClient: () => ({ auth }) };
      if (name === "./data") return { isSnapshot: (value) => !!value && Array.isArray(value.jobs) && typeof value.owner === "string" };
      throw new Error("Unexpected import " + name);
    },
    fetch, localStorage: { getItem: (key) => storage.get(key) ?? null, setItem: (key, value) => storage.set(key, value), removeItem: (key) => storage.delete(key) },
  }, { filename: "cloud.js" });
  return { api: cloudModule.exports, requests, storage, state, ok, fail };
}

test("ledger mode uses the atomic RPC and advances the account revision for partial payments and edits", async () => {
  const h = harness();
  assert.equal((await h.api.loadCloudState()).revision, 1);
  const job = { id: "fictional-job", customer: "Fictional Customer", total: 100, paid: 0 };
  await h.api.saveCloud(snapshot([job]), "fictional-a");
  await h.api.saveCloud(snapshot([{ ...job, paid: 25 }], [{ id: "fictional-payment", jobId: job.id, customer: job.customer, amount: 25, date: "2026-10-09" }]), "fictional-a");
  await h.api.saveCloud(snapshot([{ ...job, total: 120, paid: 25 }], [{ id: "fictional-payment", jobId: job.id, customer: job.customer, amount: 25, date: "2026-10-09" }]), "fictional-a");
  assert.deepEqual(h.requests.filter((item) => item.endpoint.endsWith("save_workspace_with_ledger")).map((item) => item.body.expected_revision), [1, 2, 3]);
  assert.equal(h.requests.some((item) => item.endpoint.endsWith("/rpc/save_workspace")), false);
});

test("zero-paid job sends no invented payment record", async () => {
  const h = harness();
  await h.api.loadCloudState();
  await h.api.saveCloud(snapshot([{ id: "zero-job", customer: "Fictional Customer", total: 50, paid: 0 }]), "fictional-a");
  const call = h.requests.find((item) => item.endpoint.endsWith("save_workspace_with_ledger"));
  assert.equal(call.body.payload.jobs[0].paid, 0);
  assert.deepEqual(call.body.payload.payments, []);
});

test("ambiguous network result retries the exact payload before a newer save", async () => {
  const h = harness();
  await h.api.loadCloudState();
  const first = snapshot([{ id: "job", customer: "Fictional Customer", total: 30, paid: 0 }]);
  const second = snapshot([{ id: "job", customer: "Fictional Customer", total: 40, paid: 0 }]);
  let failed = false;
  h.state.rpc = async (body) => {
    if (!failed) {
      failed = true;
      h.state.payload = body.payload;
      h.state.revision = 2;
      throw new TypeError("network response lost");
    }
    if (JSON.stringify(body.payload) !== JSON.stringify(h.state.payload)) {
      assert.equal(body.expected_revision, h.state.revision);
      h.state.payload = body.payload;
      h.state.revision++;
    }
    return h.ok({ revision: h.state.revision, ledger_events: 0, unchanged: true });
  };
  await assert.rejects(h.api.saveCloud(first, "fictional-a"), /network response lost/);
  await h.api.saveCloud(second, "fictional-a");
  const calls = h.requests.filter((item) => item.endpoint.endsWith("save_workspace_with_ledger"));
  assert.deepEqual(calls.map((item) => item.body.expected_revision), [1, 1, 2]);
  assert.deepEqual(calls.map((item) => item.body.payload), [first, first, second]);
});

test("revision conflict blocks later saves and preserves the dirty local snapshot", async () => {
  const h = harness();
  await h.api.loadCloudState();
  const local = snapshot([{ id: "local", customer: "Fictional Customer", total: 25, paid: 0 }]);
  h.api.markLedgerDirty("fictional-a", local);
  h.state.rpc = async () => h.fail(400, "WORKSPACE_REVISION_CONFLICT", "P0001");
  await assert.rejects(h.api.saveCloud(local, "fictional-a"), /WORKSPACE_REVISION_CONFLICT/);
  await assert.rejects(h.api.saveCloud(local, "fictional-a"), /WORKSPACE_REVISION_CONFLICT/);
  assert.equal(h.requests.filter((item) => item.endpoint.endsWith("save_workspace_with_ledger")).length, 1);
  assert.equal(JSON.stringify(h.api.readLedgerDirty("fictional-a").snapshot), JSON.stringify(local));
});

test("rejected payment mismatch does not poison a corrected save", async () => {
  const h = harness();
  await h.api.loadCloudState();
  const bad = snapshot([{ id: "job", customer: "Fictional Customer", total: 50, paid: 10 }]);
  let rejected = false;
  h.state.rpc = async (body) => {
    if (!rejected) { rejected = true; return h.fail(400, "JOB_PAYMENT_RECONCILIATION_FAILED:job", "P0001"); }
    assert.equal(body.expected_revision, 1);
    h.state.payload = body.payload;
    h.state.revision = 2;
    return h.ok({ revision: 2, ledger_events: 2, unchanged: false });
  };
  await assert.rejects(h.api.saveCloud(bad, "fictional-a"), /JOB_PAYMENT_RECONCILIATION_FAILED/);
  await h.api.saveCloud(snapshot([{ ...bad.jobs[0], paid: 0 }]), "fictional-a");
  assert.equal(h.requests.filter((item) => item.endpoint.endsWith("save_workspace_with_ledger")).length, 2);
});

test("account switch cannot route a former owner's save to the new owner", async () => {
  const h = harness();
  await h.api.loadCloudState();
  h.state.owner = "fictional-b";
  await assert.rejects(h.api.saveCloud(snapshot(), "fictional-a"), /ACCOUNT_CHANGED/);
  assert.equal(h.requests.some((item) => item.endpoint.includes("/rpc/")), false);
});

test("legacy schema without the mode table keeps the legacy save path; denied mode query fails closed", async () => {
  const legacy = harness({ mode: "missing" });
  assert.equal((await legacy.api.loadCloudState()).ledgerEnabled, false);
  await legacy.api.saveCloud(snapshot(), "fictional-a");
  assert.equal(legacy.requests.some((item) => item.endpoint.endsWith("/rpc/save_workspace")), true);
  const denied = harness({ mode: "denied" });
  await assert.rejects(denied.api.loadCloudState(), /permission denied/);
  assert.equal(denied.requests.some((item) => item.endpoint.includes("/rpc/")), false);
});

test("refresh retains the account-scoped dirty snapshot and revision", async () => {
  const first = harness();
  await first.api.loadCloudState();
  const changed = snapshot([{ id: "offline-job", customer: "Fictional Customer", total: 15, paid: 0 }]);
  first.api.markLedgerDirty("fictional-a", changed);
  const refreshed = harness({ storage: first.storage, initial: first.state.payload, revision: first.state.revision });
  const cloud = await refreshed.api.loadCloudState();
  assert.equal(cloud.revision, 1);
  assert.equal(JSON.stringify(refreshed.api.readLedgerDirty("fictional-a").snapshot), JSON.stringify(changed));
  assert.equal(refreshed.api.readLedgerDirty("fictional-b"), null);
  await refreshed.api.saveCloud(changed, "fictional-a");
  assert.equal(refreshed.api.readLedgerDirty("fictional-a"), null);
});

test("JSON equality ignores undefined object fields omitted by PostgREST", () => {
  const h = harness();
  assert.equal(h.api.cloudSnapshotsEqual({ job: { id: "x", createdAt: undefined } }, { job: { id: "x" } }), true);
});

test("concurrent saves serialize at successive revisions", async () => {
  const h = harness();
  await h.api.loadCloudState();
  const first = snapshot([{ id: "job", customer: "Fictional Customer", total: 10, paid: 0 }]);
  const second = snapshot([{ id: "job", customer: "Fictional Customer", total: 12, paid: 0 }]);
  await Promise.all([h.api.saveCloud(first, "fictional-a"), h.api.saveCloud(second, "fictional-a")]);
  assert.deepEqual(h.requests.filter((item) => item.endpoint.endsWith("save_workspace_with_ledger")).map((item) => item.body.expected_revision), [1, 2]);
  assert.equal(JSON.stringify(h.state.payload), JSON.stringify(second));
});

test("deleting an active customer only sends the revised snapshot to the server", async () => {
  const job = { id: "historical-job", customer: "Fictional Customer", total: 80, paid: 0 };
  const h = harness({ initial: snapshot([job]) });
  await h.api.loadCloudState();
  await h.api.saveCloud(snapshot(), "fictional-a");
  const call = h.requests.find((item) => item.endpoint.endsWith("save_workspace_with_ledger"));
  assert.deepEqual(call.body.payload.jobs, []);
  assert.equal(h.requests.some((item) => item.endpoint.includes("hisaab_ledger_transactions")), false);
});

test("refresh preserves unknown pre-activation local data instead of pairing it with a new revision", async () => {
  const h = harness({ revision: 7 });
  const server = snapshot([{ id: "server", customer: "Server Customer", total: 30, paid: 0 }]);
  const local = snapshot([{ id: "local", customer: "Local Customer", total: 20, paid: 0 }]);
  const decision = h.api.reconcileLedgerHydration(server, 7, local, null);
  assert.equal(decision.conflict, true);
  assert.equal(decision.markUnknown, true);
  assert.equal(JSON.stringify(decision.snapshot), JSON.stringify(local));
  await h.api.loadCloudState();
  h.api.markLedgerDirty("fictional-a", local, 0);
  assert.equal(h.api.readLedgerDirty("fictional-a").revision, 0);
  h.api.blockCloudSaves("fictional-a");
  await assert.rejects(h.api.saveCloud(local, "fictional-a"), /WORKSPACE_REVISION_CONFLICT/);
  assert.equal(h.requests.some((item) => item.endpoint.endsWith("save_workspace_with_ledger")), false);
});

test("refresh resumes a known unsynced edit only when the server revision still matches", () => {
  const h = harness();
  const server = snapshot();
  const local = snapshot([{ id: "unsynced", customer: "Fictional Customer", total: 20, paid: 0 }]);
  assert.equal(h.api.reconcileLedgerHydration(server, 4, local, { snapshot: local, revision: 4 }).conflict, false);
  assert.equal(h.api.reconcileLedgerHydration(server, 5, local, { snapshot: local, revision: 4 }).conflict, true);
  assert.equal(h.api.reconcileLedgerHydration(local, 5, local, { snapshot: local, revision: 4 }).clearDirty, true);
});

test("account switching keeps workspace revisions and backup restores isolated", async () => {
  const h = harness();
  const accountA = snapshot([{ id: "a", customer: "A Customer", total: 10, paid: 0 }]);
  const accountB = snapshot([{ id: "b", customer: "B Customer", total: 90, paid: 0 }]);
  await h.api.loadCloudState();
  h.state.owner = "fictional-b";
  h.state.payload = accountB;
  h.state.revision = 9;
  const cloudB = await h.api.loadCloudState();
  assert.equal(cloudB.ownerId, "fictional-b");
  assert.equal(cloudB.revision, 9);
  const olderBackupB = snapshot([{ id: "b", customer: "B Customer", total: 80, paid: 0 }]);
  await h.api.saveCloud(olderBackupB, "fictional-b");
  h.state.owner = "fictional-a";
  h.state.payload = snapshot();
  h.state.revision = 1;
  await h.api.saveCloud(accountA, "fictional-a");
  const calls = h.requests.filter((item) => item.endpoint.endsWith("save_workspace_with_ledger"));
  assert.deepEqual(calls.map((item) => item.body.expected_revision), [9, 1]);
  assert.deepEqual(calls.map((item) => item.token), ["Bearer fictional-b-token", "Bearer fictional-a-token"]);
  assert.equal(JSON.stringify(calls[0].body.payload), JSON.stringify(olderBackupB));
  assert.equal(JSON.stringify(calls[1].body.payload), JSON.stringify(accountA));
});

test("backup history fetched for one account is rejected if the account switches in flight", async () => {
  const h = harness();
  h.state.switchDuringBackups = true;
  await assert.rejects(h.api.loadWorkspaceBackups("fictional-a"), /ACCOUNT_CHANGED/);
  assert.equal(h.requests.find((item) => item.endpoint.includes("workspace_backups")).token, "Bearer fictional-a-token");
});
