const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const ts = require('typescript');

function load(file, mocks = {}, globals = {}) {
  const source = ts.transpileModule(fs.readFileSync(file, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true },
  }).outputText;
  const module = { exports: {} };
  vm.runInNewContext(source, { module, exports: module.exports, require: name => mocks[name] || require(name),
    process, Buffer, Date, JSON, Number, Response, Request, ...globals });
  return module.exports;
}
const events = load('lib/admin-push-event.ts');
const id = '11111111-1111-4111-8111-111111111111';
const secret = 'test-hook-secret-of-at-least-24-bytes';

function routeHarness(options = {}) {
  const sent = [];
  const calls = [];
  const fetch = async (url, init) => {
    const path = new URL(url).pathname;
    calls.push(path);
    if (path.endsWith('/admin_push_settings')) return Response.json([{ payments: options.mute !== 'payments', trials: options.mute !== 'trials', signups: options.mute !== 'signups' }]);
    if (path.endsWith('/claim_admin_push_event')) return Response.json(options.duplicate ? false : true);
    if (path.endsWith('/admin_push_subscriptions')) return Response.json([{ subscription: { endpoint: 'https://push.example.test/a', keys: { auth: 'a', p256dh: 'b' } } }]);
    throw new Error('Unexpected database path: ' + path);
  };
  const webpush = { setVapidDetails() {}, async sendNotification(subscription, payload) { sent.push(JSON.parse(payload)); if (options.sendFails) throw new Error('push failed'); } };
  const original = { ...process.env };
  process.env.ADMIN_HOOK_SECRET = secret;
  process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://db.example.test';
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'service-test';
  process.env.VAPID_PUBLIC_KEY = 'public-test';
  process.env.VAPID_PRIVATE_KEY = 'private-test';
  const route = load('app/api/hook/route.ts', { 'web-push': { __esModule: true, default: webpush }, '@/lib/admin-push-event': events }, { fetch });
  return { route, sent, calls, restore() { process.env = original; } };
}

const request = (body, supplied = secret) => new Request('https://admin.example.test/api/hook', {
  method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Hook-Secret': supplied }, body: JSON.stringify(body),
});

test('payment, trial, and signup inserts produce exact safe push text and destinations', () => {
  const payment = events.parseAdminPushEvent({ type: 'payment', id, plan: 'smart', amount: 179, email: 'secret@example.com', proof_url: 'https://secret' });
  assert.equal(payment.title, 'Payment request: Smart ₹179');
  assert.equal(payment.url, '/admin?tab=payments');
  const trial = events.parseAdminPushEvent({ type: 'trial', id, claimed_at: '2026-11-13T01:00:00Z' });
  assert.equal(trial.title, 'New free trial claimed');
  const signup = events.parseAdminPushEvent({ type: 'signup', email_masked: 's***@gmail.com', created_at: '2026-11-13T01:00:00Z' });
  assert.equal(signup.title, 'New user: s***@gmail.com');
  assert.equal(signup.url, '/admin?tab=users');
  assert.equal(events.parseAdminPushEvent({ type: 'signup', email_masked: 'sarah@gmail.com', created_at: '2026-11-13T01:00:00Z' }), null);
  assert.equal(JSON.stringify([payment, trial, signup]).includes('secret@example.com'), false);
});

test('wrong hook secret is rejected before database access', async () => {
  const harness = routeHarness();
  try {
    const response = await harness.route.POST(request({ type: 'trial', id, claimed_at: '2026-11-13T01:00:00Z' }, 'wrong'));
    assert.equal(response.status, 401);
    assert.equal(harness.calls.length, 0);
  } finally { harness.restore(); }
});

test('invalid webhook payload is rejected without a push', async () => {
  const harness = routeHarness();
  try {
    const response = await harness.route.POST(request({ type: 'signup', email_masked: 'full@example.com', created_at: '2026-11-13T01:00:00Z' }));
    assert.equal(response.status, 400);
    assert.equal(harness.calls.length, 0);
    assert.equal(harness.sent.length, 0);
  } finally { harness.restore(); }
});

test('muted event and duplicate delivery send no push', async () => {
  for (const options of [{ mute: 'payments' }, { duplicate: true }]) {
    const harness = routeHarness(options);
    try {
      const response = await harness.route.POST(request({ type: 'payment', id, plan: 'basic', amount: 99 }));
      assert.equal(response.status, 200);
      assert.equal(harness.sent.length, 0);
    } finally { harness.restore(); }
  }
});

test('send failures still return HTTP 200', async () => {
  const harness = routeHarness({ sendFails: true });
  try {
    const response = await harness.route.POST(request({ type: 'signup', email_masked: 's***@gmail.com', created_at: '2026-11-13T01:00:00Z' }));
    assert.equal(response.status, 200);
    assert.equal(harness.sent[0].title, 'New user: s***@gmail.com');
  } finally { harness.restore(); }
});

test('hook sends each event with its matching title and admin tab', async () => {
  for (const [body, title, url] of [
    [{ type: 'payment', id, plan: 'business', amount: 299 }, 'Payment request: Business ₹299', '/admin?tab=payments'],
    [{ type: 'trial', id, claimed_at: '2026-11-13T01:00:00Z' }, 'New free trial claimed', '/admin?tab=users'],
    [{ type: 'signup', email_masked: 's***@gmail.com', created_at: '2026-11-13T01:00:00Z' }, 'New user: s***@gmail.com', '/admin?tab=users'],
  ]) {
    const harness = routeHarness();
    try {
      const response = await harness.route.POST(request(body));
      assert.equal(response.status, 200);
      assert.equal(harness.sent.length, 1);
      assert.equal(harness.sent[0].title, title);
      assert.equal(harness.sent[0].url, url);
    } finally { harness.restore(); }
  }
});

test('signup SQL masks the address, catches trigger failures, and supplies rollback', () => {
  const sql = fs.readFileSync('supabase/admin-signup-hook.sql', 'utf8');
  assert.match(sql, /create extension if not exists pg_net/);
  assert.match(sql, /security definer set search_path = public, extensions/i);
  assert.match(sql, /exception when others then null/i);
  assert.match(sql, /after insert on auth\.users[\s\S]*for each row/i);
  assert.match(sql, /email_masked/);
  assert.match(sql, /drop trigger if exists admin_new_user_push on auth\.users/);
  assert.ok(!sql.includes(secret));
  const settings = fs.readFileSync('supabase/migrations/20261113000002_admin_push.sql', 'utf8');
  assert.match(settings, /payments boolean not null default true/);
  assert.match(settings, /trials boolean not null default true/);
  assert.match(settings, /signups boolean not null default true/);
  assert.match(settings, /interval '60 seconds'/);
});
