const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');
const { webcrypto } = require('node:crypto');

const read = file => fs.readFileSync(path.join(__dirname, '..', file), 'utf8');
const compile = text => ts.transpileModule(text, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;

// The real chat functions, taken from app/workspace.tsx by AST.
const workspace = read('app/workspace.tsx');
const ast = ts.createSourceFile('workspace.tsx', workspace, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
const functions = new Map();
(function visit(node) {
  if (ts.isFunctionDeclaration(node) && node.name) functions.set(node.name.text, node.getText(ast));
  ts.forEachChild(node, visit);
})(ast);
const chatCode = compile(['processAssistantMessage', 'retryAssistant', 'undoNewEntry'].map(name => {
  assert.ok(functions.has(name), `${name} exists in app/workspace.tsx`);
  return functions.get(name);
}).join('\n'));

const timeoutConstant = workspace.match(/const ASSISTANT_TIMEOUT_MS = ([\d_]+);/);

const chatEntry = { exports: {} };
vm.runInNewContext(compile(read('lib/chat-entry.ts')), { module: chatEntry, exports: chatEntry.exports, Date });

const ravisCard = () => ({ id: 'old', customer: 'Ravi', work: 'kaam', total: 500, paid: 100, date: '2026-11-09', time: '10:00', status: 'Confirmed', source: 'old message' });
const reply = (status, body) => ({ ok: status >= 200 && status < 300, status, json: async () => body });

function harness({ fetch, timeoutMs = 30000, ...overrides } = {}) {
  const state = { turns: [], pendingJob: undefined, selectedCustomer: undefined, replacedEntry: undefined, fetchCalls: 0, toasts: [] };
  const context = {
    console: { log() {}, error() {}, warn() {} },
    crypto: webcrypto,
    window: { setTimeout, clearTimeout },
    AbortController,
    navigator: { onLine: true },
    ASSISTANT_TIMEOUT_MS: timeoutMs,
    assistantInFlightRef: { current: false },
    activeUserIdRef: { current: 'owner' },
    requireActiveSubscriptionForSaving: () => true,
    cloudToken: async () => 'token',
    day: () => '2026-11-05',
    blank: () => ({ id: '', customer: '', work: '', total: 0, paid: 0, date: '', time: '', status: 'Waiting', source: '' }),
    pendingReminderText: '',
    pendingJob: null,
    selectedCustomer: null,
    replacedEntry: null,
    jobs: [],
    customerNames: [],
    ledgerModeForAccount: () => false,
    paymentPaise: value => Math.round(Number(value) * 100),
    paymentRupees: value => value / 100,
    validateEntryMoney() {},
    ...chatEntry.exports,
    fetch: (url, init) => { state.fetchCalls++; state.lastBody = JSON.parse(init.body); return fetch(url, init); },
    setChatTurns: next => { state.turns = typeof next === 'function' ? next(state.turns) : next; },
    setPendingJob: value => { state.pendingJob = value; },
    setSelectedCustomer: value => { state.selectedCustomer = value; },
    setReplacedEntry: value => { state.replacedEntry = value; },
    setChatStep() {}, setEntryMode() {}, setCustomerChatOpen() {}, setPendingReminderText() {},
    setReminders() {}, setNotes() {}, setPayments() {}, setJobs() {},
    setToast: value => state.toasts.push(value),
    say: (role, text) => { state.turns = [...state.turns, { id: `say-${state.turns.length}`, role, text }]; },
    ...overrides,
  };
  vm.createContext(context);
  vm.runInContext(chatCode, context);
  return { context, state };
}

// ---------------- timeout, errors, retry ----------------

test('workspace uses a 30-second client timeout', () => {
  assert.ok(timeoutConstant, 'ASSISTANT_TIMEOUT_MS is declared');
  assert.equal(Number(timeoutConstant[1].replace(/_/g, '')), 30000);
});

test('a reply that never comes is aborted and leaves a Try again reply', async () => {
  const { context, state } = harness({
    timeoutMs: 20,
    fetch: (url, init) => new Promise((resolve, reject) => {
      init.signal.addEventListener('abort', () => reject(Object.assign(new Error('aborted'), { name: 'AbortError' })));
    }),
  });
  await context.processAssistantMessage('Ravi ne 500 ka kaam diya', 'text');
  assert.equal(state.fetchCalls, 1);
  assert.equal(state.turns.length, 1);
  assert.match(state.turns[0].text, /more than 30 seconds/);
  assert.equal(state.turns[0].retryText, 'Ravi ne 500 ka kaam diya');
  assert.equal(context.assistantInFlightRef.current, false);
});

test('a 502 server error leaves a Try again reply with the server message', async () => {
  const { context, state } = harness({ fetch: async () => reply(502, { error: 'Groq API error: 502' }) });
  await context.processAssistantMessage('hello', 'text');
  assert.match(state.turns.at(-1).text, /Groq API error: 502/);
  assert.equal(state.turns.at(-1).retryText, 'hello');
});

test('a 504 from the server timeout is retryable', async () => {
  const { context, state } = harness({ fetch: async () => reply(504, { error: 'Pakki Baat took too long to answer. Please try again.' }) });
  await context.processAssistantMessage('hello', 'text');
  assert.equal(state.turns.at(-1).retryText, 'hello');
});

test('a 429 rate limit is retryable', async () => {
  const { context, state } = harness({ fetch: async () => reply(429, { error: 'Rate limit' }) });
  await context.processAssistantMessage('hello', 'text');
  assert.equal(state.turns.at(-1).retryText, 'hello');
});

test('a network failure is retryable', async () => {
  const { context, state } = harness({ fetch: async () => { throw new TypeError('Failed to fetch'); } });
  await context.processAssistantMessage('hello', 'text');
  assert.equal(state.turns.at(-1).retryText, 'hello');
  assert.equal(context.assistantInFlightRef.current, false);
});

test('a 403 shows the reason without Try again', async () => {
  const { context, state } = harness({ fetch: async () => reply(403, { error: 'Your Pakki Baat subscription is not active.' }) });
  await context.processAssistantMessage('hello', 'text');
  assert.match(state.turns.at(-1).text, /subscription is not active/);
  assert.equal(state.turns.at(-1).retryText, undefined);
});

test('a second message while one is running sends no second request and keeps the text', async () => {
  let finish;
  const { context, state } = harness({ fetch: () => new Promise(resolve => { finish = resolve; }) });
  const first = context.processAssistantMessage('first', 'text');
  await new Promise(resolve => setImmediate(resolve));
  await context.processAssistantMessage('second', 'text');
  assert.equal(state.fetchCalls, 1);
  assert.match(state.turns.at(-1).text, /still working/);
  assert.equal(state.turns.at(-1).retryText, 'second');
  finish(reply(200, { updated: { work: 'kaam', total: 500 } }));
  await first;
  assert.equal(context.assistantInFlightRef.current, false);
});

test('Try again clears the button and resends the same text', async () => {
  const { context, state } = harness({ fetch: async () => reply(200, { updated: { work: 'kaam', total: 500 }, extracted: { work: 'kaam', total: 500 } }) });
  state.turns = [{ id: 'failed', role: 'assistant', text: "I couldn't finish that.", retryText: 'Ravi ne 500 ka kaam diya' }];
  context.retryAssistant('failed', 'Ravi ne 500 ka kaam diya');
  await new Promise(resolve => setTimeout(resolve, 10));
  assert.equal(state.turns[0].retryText, undefined);
  assert.equal(state.fetchCalls, 1);
  assert.equal(state.lastBody.message, 'Ravi ne 500 ka kaam diya');
});

// ---------------- new entry for a different customer ----------------

test('a full entry for a different customer starts a new card, and Undo restores the old one', async () => {
  const { context, state } = harness({
    pendingJob: ravisCard(),
    selectedCustomer: 'Ravi',
    customerNames: ['Ravi', 'Asha'],
    fetch: async () => reply(200, {
      updated: { customer: 'Ravi', work: 'brownie order', total: 200, paid: 100, date: '2026-11-09' },
      extracted: { customer: 'asha', work: 'brownie order', total: 200 },
    }),
  });
  await context.processAssistantMessage('Asha ne brownie ka order diya 200 rupaye', 'text');

  assert.equal(state.pendingJob.customer, 'Asha');
  assert.notEqual(state.pendingJob.id, 'old');
  assert.equal(state.pendingJob.work, 'brownie order');
  assert.equal(state.pendingJob.total, 200);
  assert.equal(state.pendingJob.paid, 0, 'old paid is not carried over');
  assert.equal(state.pendingJob.date, '', 'old date is not carried over');
  assert.equal(state.selectedCustomer, 'Asha');
  const started = state.turns.at(-1);
  assert.equal(started.text, 'Started a new entry for Asha.');
  assert.equal(started.customer, 'Asha');
  assert.ok(started.undoId);
  assert.equal(state.replacedEntry.id, started.undoId);
  assert.equal(state.replacedEntry.pending.id, 'old');

  context.replacedEntry = state.replacedEntry;
  context.undoNewEntry(started.undoId);
  assert.equal(state.pendingJob.id, 'old');
  assert.equal(state.selectedCustomer, 'Ravi');
  assert.equal(state.replacedEntry, null);
  assert.match(state.turns.at(-1).text, /^Undone\. Back to Ravi's entry\.$/);
});

test('Undo with a stale id does nothing', () => {
  const { context, state } = harness({ replacedEntry: { id: 'current', pending: ravisCard(), customer: 'Ravi' } });
  context.undoNewEntry('older');
  assert.equal(state.pendingJob, undefined);
  assert.equal(state.turns.length, 0);
});

test('a short answer (only an amount) updates the open card', async () => {
  const { context, state } = harness({
    pendingJob: ravisCard(),
    selectedCustomer: 'Ravi',
    fetch: async () => reply(200, { updated: { customer: 'Ravi', work: 'kaam', total: 800, paid: 100 }, extracted: { total: 800 } }),
  });
  await context.processAssistantMessage('800 total', 'text');
  assert.equal(state.pendingJob.id, 'old');
  assert.equal(state.pendingJob.customer, 'Ravi');
  assert.equal(state.pendingJob.total, 800);
  assert.equal(state.selectedCustomer, undefined, 'the book does not change');
  assert.equal(state.turns.length, 0);
});

test('an older server without `extracted` keeps the old merge behaviour', async () => {
  const { context, state } = harness({
    pendingJob: ravisCard(),
    selectedCustomer: 'Ravi',
    fetch: async () => reply(200, { updated: { customer: 'Ravi', work: 'brownie order', total: 200 } }),
  });
  await context.processAssistantMessage('Asha ne brownie ka order diya 200 rupaye', 'text');
  assert.equal(state.pendingJob.id, 'old');
});

// ---------------- static checks ----------------

test('Discard transcription also clears the saved entry draft', () => {
  const start = workspace.indexOf('aria-label="Discard transcription"');
  assert.ok(start > 0);
  const handler = workspace.slice(start, workspace.indexOf('}}', start));
  assert.match(handler, /clearEntryDraft\(\)/);
});

test('the chat attach icon is not rendered', () => {
  const composer = read('app/chat-composer.tsx');
  assert.ok(!/\{uploadControl\}/.test(composer), 'uploadControl is not placed in the JSX');
});

test('a customer book shows the latest reply with Undo and Try again', () => {
  const start = workspace.indexOf('className="entry-assistant-reply"');
  assert.ok(start > 0, 'reply strip is rendered');
  const strip = workspace.slice(start, start + 1500);
  assert.match(strip, /undoNewEntry\(/);
  assert.match(strip, /retryAssistant\(/);
});

test('process-message: server timeout, extracted fields and prompt rules', () => {
  const route = read('app/api/process-message/route.ts');
  assert.match(route, /signal: AbortSignal\.timeout\(25000\)/);
  assert.match(route, /status: 504/);
  assert.match(route, /extracted: parsed\.extracted \?\? null/);
  assert.match(route, /unless the message clearly names a different customer for a new order or payment/);
  assert.match(route, /15\. When a name carries an honorific such as bhai, bhaiya, ji, sahab, saab, didi, behen, madam or sir, return the name without it/);
});
