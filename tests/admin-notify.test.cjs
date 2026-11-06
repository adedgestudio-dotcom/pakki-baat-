const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');
const nodeCrypto = require('node:crypto');

const read = file => fs.readFileSync(path.join(__dirname, '..', file), 'utf8');

function loadTs(file, modules, globals) {
  const code = ts.transpileModule(read(file), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true },
  }).outputText;
  const mod = { exports: {} };
  const requireMock = name => {
    if (name in modules) return modules[name];
    throw new Error(`unexpected require: ${name}`);
  };
  vm.runInNewContext(code, { module: mod, exports: mod.exports, require: requireMock, ...globals }, { filename: file });
  return mod.exports;
}

// Fake values only; the tests check none of them leak into an alert.
const ENV = {
  NEXT_PUBLIC_SUPABASE_URL: 'https://db.example.supabase.co',
  NEXT_PUBLIC_SUPABASE_ANON_KEY: 'anon-key-0123456789abcdef',
  SUPABASE_SERVICE_ROLE_KEY: 'service-role-secret-0123456789',
  RESEND_API_KEY: 're_test_secret_0123456789',
  ADMIN_NOTIFY_EMAIL: 'owner@example.com',
  TRIAL_EMAIL_FROM: 'Pakki Baat <alerts@example.com>',
  TELEGRAM_BOT_TOKEN: '123456:telegram-secret-token-xyz',
  TELEGRAM_CHAT_ID: '987654',
  NEXT_PUBLIC_APP_URL: 'https://pakki.example.com/',
  ADMIN_PIN: '739150',
};
const USER_TOKEN = 'user-session-token-abc123';
const USER = { id: '11111111-2222-4333-8444-555555555555', email: 'asha@example.com' };
const KEY = '0b5f3c1e-8d2a-4f6b-9c7d-1a2b3c4d5e6f';
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=', 'base64');

const isAlert = url => url === 'https://api.resend.com/emails' || url.startsWith('https://api.telegram.org/');

function channel(mode) {
  if (mode === 'ok') return new Response('{"id":"x"}', { status: 200 });
  if (mode === 'error') return new Response('{"message":"provider down"}', { status: 500 });
  if (mode === 'throw') throw new TypeError('fetch failed');
  throw new Error('unknown mode ' + mode);
}

function makeFetch({ created = true, reserveStatus = 200, claim = { allowed: true, reason: 'trial_claimed' }, claimStatus = 200, resend = 'ok', telegram = 'ok' } = {}) {
  const calls = [];
  const fetch = async (input, init = {}) => {
    const url = String(input);
    calls.push({ url, init });
    const json = (body, status = 200) => new Response(JSON.stringify(body), { status });
    if (url.endsWith('/auth/v1/user')) return json(USER);
    if (url.includes('/rpc/reserve_subscription_payment_request')) {
      if (reserveStatus !== 200) return new Response('database unavailable', { status: reserveStatus });
      const body = JSON.parse(init.body);
      return json([{ id: 'request-1', proof_path: body.p_proof_path, created }]);
    }
    if (url.includes('/storage/v1/object/payment-proofs/')) {
      return init.method === 'HEAD' ? new Response(null, { status: 404 }) : json({ Key: 'ok' });
    }
    if (url.includes('/rpc/claim_trial')) return claimStatus === 200 ? json(claim) : new Response('error', { status: claimStatus });
    if (url === 'https://api.resend.com/emails') return channel(resend);
    if (url.startsWith('https://api.telegram.org/')) return channel(telegram);
    throw new Error('unexpected fetch ' + url);
  };
  return { fetch, calls, alerts: () => calls.filter(call => isAlert(call.url)) };
}

function setup(file, { env = ENV, ...fetchOptions } = {}) {
  const mock = makeFetch(fetchOptions);
  const afterQueue = [];
  const globals = {
    process: { env: { ...env } },
    fetch: mock.fetch,
    AbortSignal,
    Response,
    URL,
    Buffer,
    File,
    console: { log() {}, error() {}, warn() {} },
  };
  const notify = loadTs('lib/admin-notify.ts', {}, globals);
  const nextServer = {
    NextResponse: { json: (body, init) => ({ status: init?.status ?? 200, body }) },
    after: callback => afterQueue.push(callback),
  };
  const route = file ? loadTs(file, { 'next/server': nextServer, crypto: nodeCrypto, '@/lib/admin-notify': notify }, globals) : null;
  return {
    ...mock,
    notify,
    route,
    afterQueue,
    // Runs the after() callbacks the way Next.js does once the response is sent.
    runAfter: async () => { for (const callback of afterQueue.splice(0)) await callback(); },
  };
}

function paymentRequest({ plan = 'Smart', transactionRef = 'UTR123456', proof = null } = {}) {
  const form = new FormData();
  form.set('plan', plan);
  form.set('transactionRef', transactionRef);
  form.set('idempotencyKey', KEY);
  if (proof) form.set('proof', proof);
  return new Request('https://pakki.example.com/api/payment-request', { method: 'POST', headers: { authorization: 'Bearer ' + USER_TOKEN }, body: form });
}

function trialRequest() {
  return new Request('https://pakki.example.com/api/trial/claim', {
    method: 'POST',
    headers: { authorization: 'Bearer ' + USER_TOKEN, 'content-type': 'application/json' },
    body: JSON.stringify({ deviceId: 'd'.repeat(32), deviceSignature: 's'.repeat(64) }),
  });
}

const bodies = s => s.alerts().map(call => String(call.init.body)).join('\n');

function assertNoSecrets(text) {
  for (const secret of [ENV.SUPABASE_SERVICE_ROLE_KEY, ENV.NEXT_PUBLIC_SUPABASE_ANON_KEY, ENV.RESEND_API_KEY, ENV.TELEGRAM_BOT_TOKEN, ENV.ADMIN_PIN, USER_TOKEN, 'payment-proofs', '/storage/v1/', 'base64', 'data:image', `${USER.id}/${KEY}`]) {
    assert.ok(!text.includes(secret), `alert body must not contain ${secret}`);
  }
}

// ---------------- lib/admin-notify.ts ----------------

test('no-op when no channel is configured', async () => {
  const s = setup(null, { env: { NEXT_PUBLIC_APP_URL: ENV.NEXT_PUBLIC_APP_URL } });
  const result = await s.notify.sendAdminAlert({ title: 'Test', lines: ['a'] });
  assert.deepEqual({ ...result }, { email: 'skipped', telegram: 'skipped' });
  assert.equal(s.calls.length, 0);
});

test('email only, or Telegram only, depending on what is configured', async () => {
  const emailOnly = setup(null, { env: { RESEND_API_KEY: ENV.RESEND_API_KEY, ADMIN_NOTIFY_EMAIL: ENV.ADMIN_NOTIFY_EMAIL } });
  assert.deepEqual({ ...(await emailOnly.notify.sendAdminAlert({ title: 'T', lines: [] })) }, { email: 'sent', telegram: 'skipped' });
  assert.equal(emailOnly.alerts().length, 1);

  const telegramOnly = setup(null, { env: { TELEGRAM_BOT_TOKEN: ENV.TELEGRAM_BOT_TOKEN, TELEGRAM_CHAT_ID: ENV.TELEGRAM_CHAT_ID } });
  assert.deepEqual({ ...(await telegramOnly.notify.sendAdminAlert({ title: 'T', lines: [] })) }, { email: 'skipped', telegram: 'sent' });
  assert.equal(telegramOnly.alerts().length, 1);

  const noRecipient = setup(null, { env: { RESEND_API_KEY: ENV.RESEND_API_KEY } });
  assert.equal((await noRecipient.notify.sendAdminAlert({ title: 'T', lines: [] })).email, 'skipped');
});

test('both channels: Resend gets from/to/subject, Telegram gets the chat id', async () => {
  const s = setup(null);
  await s.notify.sendAdminAlert({ title: 'New payment request: Smart ₹179', lines: ['Plan: Smart'] });
  const [email, telegram] = [s.alerts().find(c => c.url.includes('resend')), s.alerts().find(c => c.url.includes('telegram'))];
  const mail = JSON.parse(email.init.body);
  assert.equal(mail.from, ENV.TRIAL_EMAIL_FROM);
  assert.deepEqual(mail.to, ['owner@example.com']);
  assert.equal(mail.subject, 'New payment request: Smart ₹179');
  assert.match(mail.text, /Plan: Smart/);
  assert.equal(email.init.headers.Authorization, 'Bearer ' + ENV.RESEND_API_KEY);
  const message = JSON.parse(telegram.init.body);
  assert.equal(message.chat_id, '987654');
  assert.match(message.text, /Plan: Smart/);
  assert.ok(email.init.signal && telegram.init.signal, 'both requests carry a timeout signal');
});

test('failing channels never throw', async () => {
  const s = setup(null, { resend: 'error', telegram: 'throw' });
  const result = await s.notify.sendAdminAlert({ title: 'T', lines: ['x'] });
  assert.deepEqual({ ...result }, { email: 'failed', telegram: 'failed' });
});

test('a channel that hangs is cut off by the timeout (3 s by default)', async () => {
  const s = setup(null);
  assert.equal(s.notify.ADMIN_ALERT_TIMEOUT_MS, 3000);
  const hanging = (url, init) => new Promise((resolve, reject) => {
    init.signal.addEventListener('abort', () => reject(init.signal.reason));
  });
  const fast = loadTs('lib/admin-notify.ts', {}, { process: { env: { ...ENV } }, fetch: hanging, AbortSignal, Response, URL, console: { warn() {} } });
  const started = Date.now();
  const result = await fast.sendAdminAlert({ title: 'T', lines: [] }, { timeoutMs: 30 });
  assert.deepEqual({ ...result }, { email: 'failed', telegram: 'failed' });
  assert.ok(Date.now() - started < 1000);
});

test('safety filter: no PIN, token, proof URL or image; secrets redacted; normal emails kept', () => {
  const s = setup(null);
  const safe = s.notify.safeAlert({
    title: 'New payment request',
    lines: [
      'PIN: 1234',
      'token=abc',
      'Authorization: Bearer xyz',
      'Proof: https://db.example.supabase.co/storage/v1/object/payment-proofs/u/k.png',
      'Image: data:image/png;base64,AAAA',
      'Note with admin pin 739150 inside',
      'Key ' + ENV.SUPABASE_SERVICE_ROLE_KEY,
      'User: pin.sharma@example.com',
      'Plan: Smart',
    ],
  });
  const text = safe.lines.join('\n');
  assert.deepEqual([...safe.lines], [
    'Note with admin pin [redacted] inside',
    'Key [redacted]',
    'User: pin.sharma@example.com',
    'Plan: Smart',
  ]);
  assertNoSecrets(text);
});

test('formatIst shows India time and adminLink builds the /admin URL', () => {
  const s = setup(null);
  assert.match(s.notify.formatIst(new Date('2026-11-06T09:30:00Z')), /6 Nov 2026,? 3:00\s?[ap]m IST/i);
  assert.equal(s.notify.adminLink('https://other.example/api/x'), 'https://pakki.example.com/admin');
  const noAppUrl = setup(null, { env: { ...ENV, NEXT_PUBLIC_APP_URL: '' } });
  assert.equal(noAppUrl.notify.adminLink('https://preview.example.app/api/x'), 'https://preview.example.app/admin');
});

// ---------------- app/api/payment-request ----------------

test('payment request: a NEW request sends one alert per channel, after the response', async () => {
  const s = setup('app/api/payment-request/route.ts');
  const response = await s.route.POST(paymentRequest());
  assert.deepEqual({ ...response, body: { ...response.body } }, { status: 200, body: { ok: true, reused: false } });
  assert.equal(s.alerts().length, 0, 'nothing is sent before the response');
  assert.equal(s.afterQueue.length, 1);
  await s.runAfter();
  assert.equal(s.alerts().filter(c => c.url.includes('resend')).length, 1);
  assert.equal(s.alerts().filter(c => c.url.includes('telegram')).length, 1);
  const text = JSON.parse(s.alerts().find(c => c.url.includes('telegram')).init.body).text;
  assert.match(text, /^New payment request: Smart ₹179/);
  for (const line of ['Type: Payment request', 'Plan: Smart', 'Amount: ₹179', 'Payment reference: UTR123456', 'User: asha@example.com', 'Admin: https://pakki.example.com/admin', 'Screenshot: not attached']) {
    assert.ok(text.includes(line), `alert contains "${line}"`);
  }
  assert.match(text, /Time: .+ IST/);
});

test('payment request: an idempotent retry (created=false) sends nothing', async () => {
  const s = setup('app/api/payment-request/route.ts', { created: false });
  const response = await s.route.POST(paymentRequest());
  assert.equal(response.body.reused, true);
  assert.equal(s.afterQueue.length, 0);
  await s.runAfter();
  assert.equal(s.alerts().length, 0);
});

test('payment request: a failed or invalid request sends nothing', async () => {
  const failed = setup('app/api/payment-request/route.ts', { reserveStatus: 500 });
  assert.equal((await failed.route.POST(paymentRequest())).status, 500);
  const invalid = setup('app/api/payment-request/route.ts');
  assert.equal((await invalid.route.POST(paymentRequest({ plan: 'Gold' }))).status, 400);
  for (const s of [failed, invalid]) {
    assert.equal(s.afterQueue.length, 0);
    assert.equal(s.alerts().length, 0);
  }
});

test('payment request with a screenshot: no secrets, proof path, URL or image in the alert', async () => {
  const s = setup('app/api/payment-request/route.ts');
  const proof = new File([PNG], 'proof.png', { type: 'image/png' });
  const response = await s.route.POST(paymentRequest({ transactionRef: '', proof }));
  assert.equal(response.status, 200);
  await s.runAfter();
  const text = bodies(s);
  assert.ok(text.includes('Screenshot: attached (view it in Admin)'));
  assert.ok(text.includes('Payment reference: none (screenshot only)'));
  assertNoSecrets(text);
});

test('payment request: failing Resend and Telegram do not change the response', async () => {
  const healthy = setup('app/api/payment-request/route.ts');
  const broken = setup('app/api/payment-request/route.ts', { resend: 'error', telegram: 'throw' });
  const a = await healthy.route.POST(paymentRequest());
  const b = await broken.route.POST(paymentRequest());
  assert.deepEqual({ ...b, body: { ...b.body } }, { ...a, body: { ...a.body } });
  await assert.doesNotReject(broken.runAfter());
  assert.equal(broken.alerts().length, 2, 'both channels were attempted');
});

// ---------------- app/api/trial/claim ----------------

test('trial claim: a new successful claim sends one alert per channel, after the response', async () => {
  const s = setup('app/api/trial/claim/route.ts');
  const response = await s.route.POST(trialRequest());
  assert.equal(response.status, 200);
  assert.equal(response.body.reason, 'trial_claimed');
  assert.equal(s.alerts().length, 0, 'nothing is sent before the response');
  await s.runAfter();
  assert.equal(s.alerts().length, 2);
  const mail = JSON.parse(s.alerts().find(c => c.url.includes('resend')).init.body);
  assert.equal(mail.subject, 'New free trial claimed');
  for (const line of ['Type: Free trial', 'Plan: Trial (30 days)', 'Amount: ₹0', 'Payment reference: none (free trial)', 'User: asha@example.com', 'Admin: https://pakki.example.com/admin']) {
    assert.ok(mail.text.includes(line), `alert contains "${line}"`);
  }
  assertNoSecrets(bodies(s));
});

test('trial claim: a repeat or refused claim sends nothing', async () => {
  for (const claim of [{ allowed: false, reason: 'trial_already_used_on_account' }, { allowed: false, reason: 'trial_already_used_on_device' }, { allowed: false, reason: 'paid_account' }]) {
    const s = setup('app/api/trial/claim/route.ts', { claim });
    const response = await s.route.POST(trialRequest());
    assert.equal(response.body.reason, claim.reason);
    assert.equal(s.afterQueue.length, 0);
  }
});

test('trial claim: a failed claim sends nothing', async () => {
  const s = setup('app/api/trial/claim/route.ts', { claimStatus: 500 });
  assert.equal((await s.route.POST(trialRequest())).status, 500);
  assert.equal(s.afterQueue.length, 0);
  assert.equal(s.alerts().length, 0);
});

test('trial claim: failing Resend and Telegram do not change the response', async () => {
  const healthy = setup('app/api/trial/claim/route.ts');
  const broken = setup('app/api/trial/claim/route.ts', { resend: 'throw', telegram: 'error' });
  const a = await healthy.route.POST(trialRequest());
  const b = await broken.route.POST(trialRequest());
  assert.deepEqual({ ...b, body: { ...b.body } }, { ...a, body: { ...a.body } });
  await assert.doesNotReject(broken.runAfter());
});
