/* eslint-disable @typescript-eslint/no-require-imports */
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const ts = require("typescript");
const vm = require("node:vm");

const compile = file => ts.transpileModule(fs.readFileSync(path.join(__dirname, file), "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;

const owner = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const other = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const snap = () => ({ jobs: [], owner: "Owner", business: "Shop", reminders: [], payments: [], notes: [], customerPhones: {} });
const isSnapshot = v => Boolean(v && Array.isArray(v.jobs) && typeof v.owner === "string" && typeof v.business === "string");

function storage(fail = false) {
  const values = new Map();
  return {
    values,
    getItem: k => values.get(k) || null,
    setItem: (k, v) => { if (fail) throw new Error("quota"); values.set(k, v); },
    removeItem: k => values.delete(k)
  };
}

function api() {
  const journal = { exports: {} };
  const transaction = { exports: {} };
  const plan = { exports: {} };
  const gate = { exports: {} };
  const special = { exports: {} };
  const reducer = { exports: {} };
  const boundary = { exports: {} };
  const compatibility = { exports: {} };
  const controller = { exports: {} };
  const lifecycleDriver = { exports: {} };
  const handoff = { exports: {} };
  const runtime = { exports: {} };

  const run = (target, file, require) => vm.runInNewContext(compile(file), { module: target, exports: target.exports, require, JSON, Date, Set, console, localStorage: undefined });

  run(journal, "../lib/workspace-journal.ts", n => n === "./data" ? { isSnapshot } : {});
  run(transaction, "../lib/workspace-transaction.ts", n => n === "./data" ? { isSnapshot } : n === "./workspace-journal" ? journal.exports : {});
  run(plan, "../lib/workspace-mutation-plan.ts", n => n === "./workspace-transaction" ? transaction.exports : {});
  run(gate, "../lib/workspace-mutation-gate.ts", () => ({}));
  run(special, "../lib/workspace-special-workflow.ts", () => ({}));
  run(reducer, "../lib/workspace-guarded-reducer.ts", n => ({ "./workspace-mutation-gate": gate.exports, "./workspace-mutation-plan": plan.exports, "./workspace-transaction": transaction.exports, "./workspace-journal": journal.exports, "./workspace-special-workflow": special.exports })[n] || {});
  run(boundary, "../lib/workspace-snapshot-boundary.ts", n => ({ react: { useCallback: fn => fn, useReducer: () => [0, () => {}], useRef: () => ({ current: null }) }, "./data": { isSnapshot }, "./workspace-guarded-reducer": reducer.exports, "./workspace-mutation-gate": gate.exports, "./workspace-mutation-plan": plan.exports, "./workspace-journal": journal.exports, "./workspace-journal-coordinator": {}, "./workspace-transaction": transaction.exports, "./workspace-special-workflow": special.exports, "./workspace-reconciliation": {}, "./verified-workspace-backup": {} })[n] || {});
  run(compatibility, "../lib/workspace-snapshot-compatibility.ts", n => ({ "./data": { isSnapshot }, "./workspace-snapshot-boundary": boundary.exports })[n] || {});
  run(controller, "../lib/workspace-snapshot-controller.ts", n => ({ react: { useCallback: fn => fn, useEffect: () => {}, useRef: () => ({ current: null }), useSyncExternalStore: (sub, get) => get() }, "./workspace-reconciliation": {}, "./workspace-journal": journal.exports, "./workspace-snapshot-compatibility": compatibility.exports, "./workspace-guarded-reducer": reducer.exports, "./workspace-snapshot-boundary": boundary.exports })[n] || {});

  // Mock lifecycle driver that tracks onDurableJournal calls
  const lifecycleCalls = [];
  const lifecycleState = { decision: { scheduled: true } };
  lifecycleDriver.exports = {
    WorkspaceJournalLifecycleDriver: class {
      constructor() {}
      async onDurableJournal(journal, snapshot) {
        lifecycleCalls.push({ journal, snapshot });
        return lifecycleState.decision;
      }
      onOwnerChanged() {}
      dispose() {}
    },
    lifecycleCalls,
    lifecycleState
  };

  // Mock handoff
  handoff.exports = {
    WorkspaceLifecycleBoundaryAcknowledgmentHandoff: class {
      constructor() {}
      onOwnerChanged() {}
      dispose() {}
      asLifecycleAcknowledgmentHandler() { return async () => {}; }
    }
  };

  run(runtime, "../lib/workspace-guarded-runtime.ts", n => ({ "./workspace-journal-lifecycle-driver": lifecycleDriver.exports, "./workspace-lifecycle-boundary-handoff": handoff.exports, "./workspace-snapshot-controller": controller.exports, "./workspace-snapshot-boundary": boundary.exports, "./workspace-guarded-reducer": reducer.exports })[n] || {});

  return {
    runtime: runtime.exports,
    controller: controller.exports,
    boundary: boundary.exports,
    journal: journal.exports,
    lifecycleCalls
  };
}

function mutation(s, extra = {}) {
  return {
    activeOwnerId: owner,
    operation: { kind: "phone", customer: "Asha", phone: "919999999999" },
    operationId: "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
    createdAt: "2026-10-11T00:00:00.000Z",
    baseRevision: 4,
    ledgerDirty: null,
    storageHealthy: true,
    cloudAvailable: true,
    storage: s,
    ...extra
  };
}

function hydratedRuntime(a, s, options = {}) {
  const session = options.session || { owner };
  const rt = new a.runtime.WorkspaceGuardedRuntime({
    activeOwnerId: async () => session.owner,
    storage: s,
    sourceSelection: () => ({ source: "guarded-signed-in", ownerId: session.owner }),
    hasCompletedOperation: options.hasCompletedOperation || (() => false)
  });
  rt.onOwnerChanged(owner);
  const hydrate = rt.controller.privilegedHydrate({ ownerId: owner, activeOwnerId: owner, snapshot: snap(), storage: s });
  assert.equal(hydrate.accepted, true);
  return { rt, session };
}

test("dispatch calls lifecycle.onDurableJournal after successful commit", async () => {
  const a = api();
  const s = storage();
  const { rt } = hydratedRuntime(a, s);

  a.lifecycleCalls.length = 0;
  const result = await rt.dispatch(mutation(s));

  assert.equal(result.accepted, true);
  assert.equal(result.sync.status, "scheduled");
  assert.equal(a.lifecycleCalls.length, 1);
  assert.equal(a.lifecycleCalls[0].journal.operationId, "cccccccc-cccc-4ccc-8ccc-cccccccccccc");
  assert.equal(a.lifecycleCalls[0].snapshot.customerPhones.Asha, "919999999999");
});

test("dispatch rejects concurrent mutations", async () => {
  const a = api();
  const s = storage();
  const { rt } = hydratedRuntime(a, s);

  a.lifecycleCalls.length = 0;

  // Start first dispatch but don't await
  const first = rt.dispatch(mutation(s));

  // Try second dispatch immediately
  const second = await rt.dispatch(mutation(s, { operationId: "dddddddd-dddd-4ddd-8ddd-dddddddddddd" }));

  assert.equal(second.accepted, false);
  assert.match(second.reason, /concurrent/i);

  // First should still succeed
  const firstResult = await first;
  assert.equal(firstResult.accepted, true);
  assert.equal(a.lifecycleCalls.length, 1);
});

test("dispatch rejects if runtime is disposed", async () => {
  const a = api();
  const s = storage();
  const { rt } = hydratedRuntime(a, s);

  rt.dispose();

  const result = await rt.dispatch(mutation(s));
  assert.equal(result.accepted, false);
  assert.match(result.reason, /disposed/i);
});

test("dispatch preserves committed snapshot when lifecycle notification fails", async () => {
  const a = api();
  const s = storage();
  const { rt } = hydratedRuntime(a, s);

  // Replace lifecycle driver with one that throws
  rt.lifecycle.onDurableJournal = async () => {
    throw new Error("Lifecycle failure");
  };

  const result = await rt.dispatch(mutation(s));

  // Dispatch should succeed despite lifecycle failure
  assert.equal(result.accepted, true);
  assert.equal(result.sync.status, "pending");
  assert.equal(result.sync.reason, "Lifecycle failure");

  // Snapshot should be committed
  const state = rt.controller.getSnapshot();
  assert.equal(state.fields.customerPhones.Asha, "919999999999");
  assert.equal(state.recovery, "pending");
});

test("dispatch rejects storage failure before commit", async () => {
  const a = api();
  const s = storage();
  const { rt } = hydratedRuntime(a, s);

  const result = await rt.dispatch(mutation(storage(true)));

  assert.equal(result.accepted, false);

  // No lifecycle notification for failed commit
  assert.equal(a.lifecycleCalls.length, 0);
});

test("dispatch rejects stale owner", async () => {
  const a = api();
  const s = storage();
  const { rt } = hydratedRuntime(a, s);

  const result = await rt.dispatch(mutation(s, { activeOwnerId: other }));

  assert.equal(result.accepted, false);
  assert.match(result.reason, /owner/i);

  // No lifecycle notification for rejected mutation
  assert.equal(a.lifecycleCalls.length, 0);
});

test("sequential dispatches each trigger lifecycle notification", async () => {
  const a = api();
  const s = storage();
  const { rt } = hydratedRuntime(a, s);

  a.lifecycleCalls.length = 0;

  const first = await rt.dispatch(mutation(s));
  assert.equal(first.accepted, true);

  const second = await rt.dispatch(mutation(s, {
    operationId: "dddddddd-dddd-4ddd-8ddd-dddddddddddd",
    operation: { kind: "profile", owner: "New", business: "New Shop" }
  }));
  assert.equal(second.accepted, true);

  assert.equal(a.lifecycleCalls.length, 2);
  assert.equal(a.lifecycleCalls[0].journal.operationId, "cccccccc-cccc-4ccc-8ccc-cccccccccccc");
  assert.equal(a.lifecycleCalls[1].journal.operationId, "dddddddd-dddd-4ddd-8ddd-dddddddddddd");
  assert.equal(a.lifecycleCalls[1].snapshot.owner, "New");
});

test("dispatch allows only the ordinary operation allowlist", async () => {
  const a = api();
  const s = storage();
  const { rt } = hydratedRuntime(a, s);
  const blocked = await rt.dispatch(mutation(s, {
    operation: { kind: "delete-customer", customer: "Asha" }
  }));
  assert.equal(blocked.accepted, false);
  assert.match(blocked.reason, /not supported/i);
  assert.equal(a.lifecycleCalls.length, 0);
});

test("dispatch rejects a stale authenticated session before durable write", async () => {
  const a = api();
  const s = storage();
  const session = { owner: other };
  const { rt } = hydratedRuntime(a, s, { session });
  const result = await rt.dispatch(mutation(s));
  assert.equal(result.accepted, false);
  assert.match(result.reason, /session/i);
  assert.equal(s.values.size, 0);
  assert.equal(a.lifecycleCalls.length, 0);
});

test("owner switch during async dedup lookup rejects before durable write", async () => {
  const a = api();
  const s = storage();
  let release;
  const lookup = new Promise(resolve => { release = resolve; });
  const { rt } = hydratedRuntime(a, s, { hasCompletedOperation: () => lookup });
  const attempt = rt.dispatch(mutation(s));
  rt.onOwnerChanged(other);
  release(false);
  const result = await attempt;
  assert.equal(result.accepted, false);
  assert.match(result.reason, /generation|owner/i);
  assert.equal(s.values.size, 0);
  assert.equal(a.lifecycleCalls.length, 0);
});

test("unscheduled lifecycle result reports local pending sync without losing journal", async () => {
  const a = api();
  const s = storage();
  const { rt } = hydratedRuntime(a, s);
  rt.lifecycle.onDurableJournal = async () => ({ scheduled: false, reason: "offline" });
  const result = await rt.dispatch(mutation(s));
  assert.equal(result.accepted, true);
  assert.equal(result.sync.status, "pending");
  assert.equal(result.sync.reason, "offline");
  assert.equal(rt.controller.getSnapshot().recovery, "pending");
  assert.ok(s.values.size > 0);
});

test("completed operation identity blocks replay and duplicate lifecycle notification", async () => {
  const a = api();
  const s = storage();
  const { rt } = hydratedRuntime(a, s);
  const first = await rt.dispatch(mutation(s));
  assert.equal(first.accepted, true);
  const replay = await rt.dispatch(mutation(s));
  assert.equal(replay.accepted, false);
  assert.match(replay.reason, /already committed/i);
  assert.equal(a.lifecycleCalls.length, 1);
});

test("durable completed-operation lookup blocks replay after runtime recreation", async () => {
  const a = api();
  const s = storage();
  const { rt } = hydratedRuntime(a, s, { hasCompletedOperation: () => true });
  const result = await rt.dispatch(mutation(s));
  assert.equal(result.accepted, false);
  assert.match(result.reason, /already committed/i);
  assert.equal(s.values.size, 0);
  assert.equal(a.lifecycleCalls.length, 0);
});

test("dispatch fails closed when durable completed-operation lookup is unavailable", async () => {
  const a = api();
  const s = storage();
  const rt = new a.runtime.WorkspaceGuardedRuntime({
    activeOwnerId: async () => owner,
    sourceSelection: () => ({ source: "guarded-signed-in", ownerId: owner })
  });
  rt.onOwnerChanged(owner);
  assert.equal(rt.controller.privilegedHydrate({ ownerId: owner, activeOwnerId: owner, snapshot: snap(), storage: s }).accepted, true);
  const result = await rt.dispatch(mutation(s));
  assert.equal(result.accepted, false);
  assert.match(result.reason, /deduplication/i);
  assert.equal(s.values.size, 0);
});
