const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const ts = require('typescript');

function harness(failingPath, subscriptionResponse) {
  const session = { user: { id: 'owner' }, access_token: 'fictional-token' };
  const events = [], signouts = [];
  const auth = {
    getSession: async () => ({ data: { session }, error: null }),
    getUser: async () => ({ data: { user: session.user }, error: null }),
    signInWithPassword: async () => ({ data: { session }, error: null }),
    signOut: async options => { signouts.push(options); return { error: null }; },
  };
  const ok = data => ({ ok: true, status: 200, text: async () => JSON.stringify(data) });
  const fail = (status, message, code) => ({ ok: false, status, text: async () => JSON.stringify({ message, code }) });
  const source = ts.transpileModule(fs.readFileSync('lib/cloud.ts', 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  const module = { exports: {} };
  vm.runInNewContext(source, { module, exports: module.exports, process: { env: { NEXT_PUBLIC_SUPABASE_URL: 'https://test.invalid', NEXT_PUBLIC_SUPABASE_ANON_KEY: 'test' } },
    require: name => name === '@supabase/supabase-js' ? { createClient: () => ({ auth }) } : name === './data' ? { isSnapshot: value => !!value && Array.isArray(value.jobs) } : require(name),
    fetch: async url => {
      if (url.includes('/subscriptions?') && subscriptionResponse) return subscriptionResponse(ok, fail);
      if (url.includes(failingPath)) return failingPath.includes('claim') ? fail(404, 'missing', 'PGRST202') : fail(400, 'SESSION_REPLACED', 'P0001');
      if (url.includes('workspace_ledger_modes')) return ok([{ enabled: true }]);
      if (url.includes('/workspaces?')) return ok([{ payload: { jobs: [] }, revision: 1 }]);
      throw new Error('Unexpected request');
    },
    localStorage: { getItem: () => null, setItem: () => {}, removeItem: () => {} }, navigator: { onLine: true },
    window: { dispatchEvent: event => events.push(event) }, CustomEvent: class { constructor(type, options) { this.type = type; this.detail = options.detail; } },
  });
  return { api: module.exports, events, signouts };
}

for (const path of ['save_workspace_with_ledger', 'save_workspace_backup']) {
  test(`SESSION_REPLACED during ${path} signs out locally and announces why`, async () => {
    const h = harness(path);
    await h.api.loadCloudState();
    await assert.rejects(path === 'save_workspace_backup' ? h.api.saveWorkspaceBackup({ jobs: [] }, 'manual', 'owner') : h.api.saveCloud({ jobs: [] }, 'owner'), /SESSION_REPLACED/);
    assert.equal(h.signouts[0].scope, 'local');
    assert.equal(h.events[0].detail, 'This account is now open on another device. You have been signed out here. Sign in again to use it on this device.');
  });
}
test('missing claim RPC does not break password sign-in', async () => {
  const h = harness('claim_device_session');
  assert.equal((await h.api.signInWithPassword('test@example.invalid', 'test')).user.id, 'owner');
  assert.equal(h.signouts.length, 0);
});

test('subscription auth failure signs out and never reports an inactive plan', async () => {
  const h = harness('unused', (_ok, fail) => fail(403, 'session_not_found'));
  const result = await requireTrial().loadTrialSubscription('owner', h.api.loadSubscription);
  assert.equal(result.state.status, 'error');
  assert.equal(h.signouts[0].scope, 'local');
  assert.equal(h.events[0].detail, h.api.replacedMessage);
});

test('expired subscription is returned only after a successful read', async () => {
  const h = harness('unused', ok => ok([{ plan: 'smart', status: 'expired', period_end: '2020-01-01' }]));
  const result = await requireTrial().loadTrialSubscription('owner', h.api.loadSubscription);
  assert.equal(result.state.status, 'existing');
  assert.equal(result.subscription.status, 'expired');
  assert.equal(h.events.length, 0);
});

test('subscription network failure does not report an inactive plan or sign out', async () => {
  const h = harness('unused', () => { throw new Error('network failure'); });
  const result = await requireTrial().loadTrialSubscription('owner', h.api.loadSubscription);
  assert.equal(result.state.status, 'error');
  assert.equal(h.events.length, 0);
});

function requireTrial() {
  const source = ts.transpileModule(fs.readFileSync('lib/trial-offer.ts', 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText;
  const module = { exports: {} };
  vm.runInNewContext(source, { module, exports: module.exports });
  return module.exports;
}
