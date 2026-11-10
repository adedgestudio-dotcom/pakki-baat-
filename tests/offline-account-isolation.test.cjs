const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const ts = require('typescript');
const source = fs.readFileSync(require('node:path').join(__dirname, '../app/workspace.tsx'), 'utf8');
const ast = ts.createSourceFile('workspace.tsx', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
let apply, restore, retry;
function visit(node) {
  if (ts.isFunctionDeclaration(node) && node.name?.text === 'applySession') apply = node;
  if (ts.isFunctionDeclaration(node) && node.name?.text === 'restore') restore = node;
  if (ts.isFunctionDeclaration(node) && node.name?.text === 'retryWorkspaceOnOnline') retry = node;
  ts.forEachChild(node, visit);
}
visit(ast);
function harness() {
  const account = { user: { id: 'account-a', email: 'a@example.test' } };
  const saved = { jobs: [{ id: 'private-a', customer: 'Private A' }], payments: [{ id: 'payment-a' }], owner: 'A', business: 'A' };
  const caches = new Map([['account-a', saved]]);
  const storage = new Map([['pakki-baat-ledger-dirty:account-a', JSON.stringify({ snapshot: saved, revision: 20 })]]);
  const state = { jobs: saved.jobs, payments: saved.payments, pendingJob: saved.jobs[0], draft: saved.jobs[0], lastUndo: { snapshot: saved }, deleteJob: saved.jobs[0], customerChatOpen: true };
  const c = { cancelled: false, sessionSequence: 0, hydratedUserId: 'account-a', hydratingUserId: null, retrySession: null, LOCAL_WORKSPACE_ID: 'local',
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
  names(restore);
  const toasts = [];
  c.setToast = value => { state.toast = value; toasts.push(value); };
  vm.createContext(c);
  vm.runInContext(ts.transpileModule(apply.getText(ast), { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText, c);
  vm.runInContext(ts.transpileModule(restore.getText(ast), { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText, c);
  vm.runInContext(ts.transpileModule(retry.getText(ast), { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText, c);
  return { c, state, caches, storage, saved, account, toasts };
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


function deferred() {
  let resolve;
  const promise = new Promise(done => { resolve = done; });
  return { promise, resolve };
}
const restoreToasts = h => h.toasts.filter(text => text === 'Workspace restored on this device.').length;

test('duplicate session callbacks during loading and after offline restore run one restore and toast', async () => {
  const h = harness(), gate = deferred();
  h.c.hydratedUserId = null;
  let reads = 0;
  h.c.loadCloudState = async () => { reads++; await gate.promise; throw Error('offline'); };
  const first = h.c.applySession(h.account);
  await new Promise(resolve => setImmediate(resolve));
  await h.c.applySession(h.account);
  assert.equal(reads, 1);
  assert.equal(h.state.ready, false);
  assert.equal(h.state.jobs, h.saved.jobs); // Last good same-account list stays visible.
  gate.resolve();
  await first;
  for (let i = 0; i < 5; i++) await h.c.applySession(h.account);
  assert.equal(reads, 1);
  assert.equal(restoreToasts(h), 1);
  assert.equal(h.state.loadedAccountId, 'account-a');
  assert.equal(h.state.ready, true);
});

test('successful cloud hydration deduplicates notifications, but logout and login restore again', async () => {
  const h = harness(); h.c.hydratedUserId = null;
  let reads = 0;
  h.c.isSnapshot = () => true;
  h.c.loadCloudState = async () => { reads++; return { snapshot: h.saved, ledgerEnabled: false }; };
  await Promise.all([h.c.applySession(h.account), h.c.applySession(h.account)]);
  await h.c.applySession(h.account);
  assert.equal(reads, 1);
  assert.equal(restoreToasts(h), 1);
  await h.c.applySession(null);
  await h.c.applySession(h.account);
  assert.equal(reads, 2);
  assert.equal(restoreToasts(h), 2);
});

test('repeated signed-out callbacks restore the guest workspace only once', async () => {
  const h = harness(); h.caches.set('local', { jobs: [], owner: 'Guest' });
  for (let i = 0; i < 5; i++) await h.c.applySession(null);
  assert.equal(restoreToasts(h), 1);
});

test('obsolete in-flight account cannot restore over a newer session', async () => {
  const h = harness(), gate = deferred(); h.c.hydratedUserId = null;
  h.c.loadTrialSubscription = async () => { await gate.promise; throw Error('offline'); };
  const old = h.c.applySession(h.account);
  await h.c.applySession(null);
  gate.resolve(); await old;
  assert.equal(h.state.jobs.length, 0);
  assert.equal(restoreToasts(h), 0);
  assert.equal(h.c.hydratedUserId, 'local');
});

test('Hisaab empty state requires completed account hydration and no customers', () => {
  let loaded, empty;
  function find(node) {
    if (ts.isVariableDeclaration(node) && node.name.getText(ast) === 'hisaabLoaded') loaded = node.initializer;
    if (ts.isJsxExpression(node) && node.expression?.getText(ast).includes('<h3>Your hisaab book is empty</h3>') && ts.isBinaryExpression(node.expression)) empty = node.expression.left;
    ts.forEachChild(node, find);
  }
  find(ast);
  assert.ok(loaded && empty);
  for (const [ready, loggedIn, loadedAccountId, names, expected] of [
    [false, true, null, [], false],
    [false, false, null, [], false],
    [true, true, null, [], false],
    [true, true, 'other-account', [], false],
    [true, true, 'account-a', ['Asha'], false],
    [true, true, 'account-a', [], true],
    [true, false, null, [], true],
  ]) {
    const context = { ready, loggedIn, loadedAccountId, accountId: 'account-a', customerNames: names };
    context.hisaabLoaded = vm.runInNewContext(loaded.getText(ast), context);
    assert.equal(vm.runInNewContext(empty.getText(ast), context), expected);
  }
  assert.ok(source.includes('!customerNames.length && !hisaabLoaded'));
  assert.ok(source.includes('Loading your Hisaab...'));
});


test('a real reconnect retries offline hydration once and then stops', async () => {
  const h = harness(); h.c.hydratedUserId = null;
  await h.c.applySession(h.account);
  assert.equal(restoreToasts(h), 1);
  let reads = 0;
  h.c.isSnapshot = () => true;
  h.c.loadCloudState = async () => { reads++; return { snapshot: h.saved, ledgerEnabled: false }; };
  h.c.retryWorkspaceOnOnline();
  h.c.retryWorkspaceOnOnline();
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(reads, 1);
  assert.equal(restoreToasts(h), 2);
  assert.equal(h.c.cloudHydratedRef.current, true);
  h.c.retryWorkspaceOnOnline();
  await h.c.applySession(h.account);
  assert.equal(reads, 1);
  assert.ok(source.includes('window.removeEventListener("online", retryWorkspaceOnOnline)'));
});


test('failed read without cache waits for a real retry instead of repeating on auth notifications', async () => {
  const h = harness(); h.c.hydratedUserId = null; h.caches.clear();
  let reads = 0;
  h.c.loadCloudState = async () => { reads++; throw Error('offline'); };
  for (let i = 0; i < 5; i++) await h.c.applySession(h.account);
  assert.equal(reads, 1);
  assert.equal(restoreToasts(h), 0);
  assert.equal(h.state.loadedAccountId, null);
});
