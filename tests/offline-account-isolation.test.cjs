const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const ts = require('typescript');
const source = fs.readFileSync(require('node:path').join(__dirname, '../app/workspace.tsx'), 'utf8');
const ast = ts.createSourceFile('workspace.tsx', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
let apply;
function visit(node) {
  if (ts.isFunctionDeclaration(node) && node.name?.text === 'applySession') apply = node;
  ts.forEachChild(node, visit);
}
visit(ast);
function harness() {
  const account = { user: { id: 'account-a', email: 'a@example.test' } };
  const saved = { jobs: [{ id: 'private-a', customer: 'Private A' }], payments: [{ id: 'payment-a' }], owner: 'A', business: 'A' };
  const caches = new Map([['account-a', saved]]);
  const storage = new Map([['pakki-baat-ledger-dirty:account-a', JSON.stringify({ snapshot: saved, revision: 20 })]]);
  const state = { jobs: saved.jobs, payments: saved.payments, pendingJob: saved.jobs[0], draft: saved.jobs[0], lastUndo: { snapshot: saved }, deleteJob: saved.jobs[0], customerChatOpen: true };
  const c = { cancelled: false, sessionSequence: 0, hydratedUserId: 'account-a', LOCAL_WORKSPACE_ID: 'local',
    activeUserIdRef: { current: 'account-a' }, pendingJobRef: { current: saved.jobs[0] }, customerChatOpenRef: { current: true },
    localStorage: { getItem: key => storage.get(key) ?? null, setItem: (key, value) => storage.set(key, value), removeItem: key => storage.delete(key) },
    window: { matchMedia: () => ({ matches: true }), navigator: {} },
    accountNameFromEmail: () => '', readLocalWorkspace: id => caches.get(id),
    loadTrialSubscription: async () => { throw Error('offline'); }, loadSubscription() {},
    loadServerTime: async () => { throw Error('offline'); }, loadVoiceUsage: async () => { throw Error('offline'); },
    loadCloudState: async () => { throw Error('offline'); },
    chatHistoryKey: id => id, entryDraftKey: id => id, isChatState: () => false,
  };
  function names(n) {
    if (ts.isIdentifier(n)) {
      const name = n.text;
      if (/^set[A-Z]/.test(name)) c[name] = value => { state[name[3].toLowerCase() + name.slice(4)] = value; };
      if (/Ref$/.test(name) && !(name in c)) c[name] = { current: null };
    }
    ts.forEachChild(n, names);
  }
  names(apply);
  c.restore = s => { state.jobs = s.jobs; state.payments = s.payments || []; state.owner = s.owner; };
  vm.createContext(c);
  vm.runInContext(ts.transpileModule(apply.getText(ast), { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText, c);
  return { c, state, caches, storage, saved, account };
}
test('session loss hides previous financial state without deleting its account cache', async () => {
  const h = harness();
  await h.c.applySession(null);
  assert.equal(h.state.jobs.length, 0);
  assert.equal(h.state.payments.length, 0);
  assert.equal(h.state.pendingJob, null);
  assert.equal(h.state.draft, null);
  assert.equal(h.state.lastUndo, null);
  assert.equal(h.state.deleteJob, null);
  assert.equal(h.state.customerChatOpen, false);
  assert.equal(h.caches.get('account-a'), h.saved);
});
test('account switch with unavailable cloud and no cache never displays previous records', async () => {
  const h = harness();
  await h.c.applySession({ user: { id: 'account-b', email: 'b@example.test' } });
  assert.equal(h.state.jobs.length, 0);
  assert.equal(h.state.payments.length, 0);
  assert.equal(h.caches.get('account-a'), h.saved);
});
test('valid offline session restores only that account cache', async () => {
  const h = harness(); h.c.hydratedUserId = null;
  await h.c.applySession(h.account);
  assert.equal(h.state.jobs[0].id, 'private-a');
  assert.equal(h.state.payments[0].id, 'payment-a');
});
test('guest snapshot is separate from authenticated snapshots', async () => {
  const h = harness(); h.caches.set('local', { jobs: [{ id: 'guest' }], payments: [], owner: 'Guest' });
  await h.c.applySession(null);
  assert.equal(h.state.jobs[0].id, 'guest');
  assert.equal(h.caches.get('account-a'), h.saved);
});
test('logout and account switch preserve outgoing durable pending payments', async () => {
  for (const session of [null, { user: { id: 'account-b', email: 'b@example.test' } }]) {
    const h = harness(), key = 'pakki-baat-ledger-dirty:account-a', pending = h.storage.get(key);
    await h.c.applySession(session);
    assert.equal(h.storage.get(key), pending);
    assert.equal(h.state.payments.length, 0);
  }
});
test('same-account session refresh keeps the unfinished entry intact', async () => {
  const h = harness(), draft = h.state.pendingJob;
  await h.c.applySession(h.account);
  assert.equal(h.state.pendingJob, draft);
  assert.equal(h.state.customerChatOpen, true);
  assert.equal(h.state.jobs[0].id, 'private-a');
});
