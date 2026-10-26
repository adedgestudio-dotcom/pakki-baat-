import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import ts from "typescript";
import { fileURLToPath } from "node:url";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");

function compile(file) {
  return ts.transpileModule(fs.readFileSync(path.join(root, file), "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
}

function loadSecurity() {
  const sandboxModule = { exports: {} };
  vm.runInNewContext(compile("lib/push-schedule-security.ts"), {
    module: sandboxModule,
    exports: sandboxModule.exports,
    URL,
    TextDecoder,
    Uint8Array,
  }, { filename: "push-schedule-security.js" });
  return sandboxModule.exports;
}

function validPayload(overrides = {}) {
  return {
    reminder: { id: "reminder-1", date: "2026-11-01", time: "09:00" },
    remindAt: "2026-11-01T03:30:00.000Z",
    subscription: {
      endpoint: "https://push.example.test/send/abc",
      keys: { auth: "aGVsbG8", p256dh: "cHVzaC1rZXk" },
    },
    ...overrides,
  };
}

function loadRoute({ userId = "user-a", v5Schedule = { scheduleId: "schedule-a", generation: 1, shouldStart: true } } = {}) {
  const security = loadSecurity();
  let starts = 0;
  let records = 0;
  const sandboxModule = { exports: {} };
  vm.runInNewContext(compile("app/api/push/schedule/route.ts"), {
    module: sandboxModule,
    exports: sandboxModule.exports,
    process: { env: {
      NEXT_PUBLIC_SUPABASE_URL: "https://supabase.example.test",
      NEXT_PUBLIC_SUPABASE_ANON_KEY: "anon",
      VAPID_PUBLIC_KEY: "public",
      VAPID_PRIVATE_KEY: "private",
    } },
    fetch: async () => new Response(JSON.stringify({ id: userId }), { status: 200 }),
    Response,
    Request,
    URL,
    TextDecoder,
    Uint8Array,
    crypto: { randomUUID: () => "runner-a" },
    require: (name) => {
      if (name === "workflow/api") return { start: async () => ({ runId: `run-${++starts}` }) };
      if (name === "@/workflows/reminder-push") return { reminderPushWorkflow: async () => undefined };
      if (name === "@/lib/push-schedule-security") return security;
      if (name === "@/lib/reminder-v5-store") return {
        ensureV5Schedule: async () => v5Schedule,
        recordV5WorkflowStart: async () => { records += 1; },
      };
      throw new Error(`Unexpected import ${name}`);
    },
  }, { filename: "push-schedule-route.js" });
  return { route: sandboxModule.exports, starts: () => starts, records: () => records };
}

test("schedule validation accepts only bounded, structurally safe push requests", () => {
  const security = loadSecurity();
  const request = security.validateScheduleRequest(validPayload());
  assert.equal(request.reminder.id, "reminder-1");
  assert.equal(security.validateScheduleRequest(validPayload({ subscription: { endpoint: "http://not-secure.test", keys: { auth: "a", p256dh: "b" } } })), null);
  assert.equal(security.validateScheduleRequest(validPayload({ reminder: { id: "x".repeat(161), date: "2026-11-01" } })), null);
});

test("bounded parser rejects oversized JSON before scheduling", async () => {
  const security = loadSecurity();
  const request = new Request("https://app.example.test/api/push/schedule", {
    method: "POST",
    body: JSON.stringify(validPayload({ padding: "x".repeat(16 * 1024) })),
  });
  assert.equal(await security.readBoundedJson(request), null);
});

test("per-user reservations reject duplicate requests and release failed starts", () => {
  const security = loadSecurity();
  security.resetScheduleRateLimitsForTests();
  const request = security.validateScheduleRequest(validPayload());
  const key = security.scheduleReservationKey("user-a", request);
  const first = security.reserveSchedule("user-a", key, 1000);
  assert.equal(first.ok, true);
  assert.equal(security.reserveSchedule("user-a", key, 1001).reason, "duplicate");
  first.release();
  assert.equal(security.reserveSchedule("user-a", key, 1002).ok, true);
  assert.equal(security.reserveSchedule("user-b", key, 1002).ok, true);
});

test("per-user scheduling is capped without mixing accounts", () => {
  const security = loadSecurity();
  security.resetScheduleRateLimitsForTests();
  for (let index = 0; index < 100; index += 1) {
    assert.equal(security.reserveSchedule("user-a", `reminder-${index}`, 1000).ok, true);
  }
  assert.equal(security.reserveSchedule("user-a", "overflow", 1000).reason, "rate_limited");
  assert.equal(security.reserveSchedule("user-b", "first", 1000).ok, true);
});

test("authenticated scheduling starts once and duplicate requests remain idempotent", async () => {
  const { route, starts, records } = loadRoute();
  const body = JSON.stringify(validPayload());
  const headers = { "content-type": "application/json", authorization: "Bearer user-token" };
  const first = await route.POST(new Request("https://app.example.test/api/push/schedule", { method: "POST", headers, body }));
  assert.equal(first.status, 200);
  assert.equal(starts(), 1);
  assert.equal(records(), 1);
  const duplicate = await route.POST(new Request("https://app.example.test/api/push/schedule", { method: "POST", headers, body }));
  assert.equal(duplicate.status, 202);
  assert.equal(starts(), 1);
});

test("legacy-v4 reminders are rejected before a Workflow 5 start", async () => {
  const { route, starts } = loadRoute({ v5Schedule: null });
  const response = await route.POST(new Request("https://app.example.test/api/push/schedule", {
    method: "POST", headers: { "content-type": "application/json", authorization: "Bearer user-token" }, body: JSON.stringify(validPayload()),
  }));
  assert.equal(response.status, 409);
  assert.equal(starts(), 0);
});

test("a durable V5 schedule suppresses browser refresh and multi-device duplicate starts", async () => {
  const { route, starts } = loadRoute({ v5Schedule: { scheduleId: "schedule-a", generation: 1, shouldStart: false } });
  const response = await route.POST(new Request("https://app.example.test/api/push/schedule", {
    method: "POST", headers: { "content-type": "application/json", authorization: "Bearer second-device-token" }, body: JSON.stringify(validPayload()),
  }));
  assert.equal(response.status, 202);
  assert.equal(starts(), 0);
});

test("V5 schema keeps rollback and retry claims durable", () => {
  const sql = fs.readFileSync(path.join(root, "supabase/migrations/20261024000000_workflow5_reminder_coexistence.sql"), "utf8");
  const workspace = fs.readFileSync(path.join(root, "app/workspace.tsx"), "utf8");
  assert.match(sql, /reminder_v5_delivery_controls/);
  assert.match(sql, /begin_v5_reminder_delivery/);
  assert.match(sql, /primary key\(schedule_id, generation, occurrence_at\)/);
  assert.match(sql, /set_v5_reminder_delivery_enabled/);
  assert.match(sql, /lease_until<now\(\)/);
  assert.match(sql, /enabled is distinct from true/);
  assert.match(workspace, /reminder\.scheduler !== "v5"/);
  assert.match(workspace, /scheduler: "v5"/);
});

test("unauthenticated and malformed scheduling requests do not start workflows", async () => {
  const { route, starts } = loadRoute();
  const unauthorized = await route.POST(new Request("https://app.example.test/api/push/schedule", {
    method: "POST",
    body: JSON.stringify(validPayload()),
  }));
  assert.equal(unauthorized.status, 401);
  const malformed = await route.POST(new Request("https://app.example.test/api/push/schedule", {
    method: "POST",
    headers: { authorization: "Bearer user-token", "content-type": "application/json" },
    body: JSON.stringify(validPayload({ subscription: { endpoint: "ftp://bad.test", keys: { auth: "a", p256dh: "b" } } })),
  }));
  assert.equal(malformed.status, 400);
  assert.equal(starts(), 0);
});
