const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');

const compiled = ts.transpileModule(fs.readFileSync(path.join(__dirname, '../lib/chat-entry.ts'), 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText;
const mod = { exports: {} };
vm.runInNewContext(compiled, { module: mod, exports: mod.exports, Date });
const { startsNewEntry, canonicalCustomer, freshEntry, sameCustomer, pickEntryReply } = mod.exports;

const ravi = { customer: 'Ravi', work: 'kaam' };

const cases = [
  ['different customer with work and amount', ravi, 'Ravi', { customer: 'Asha', work: 'brownie order', total: 200 }, true],
  ['different customer with only a balance', ravi, 'Ravi', { customer: 'Imran', balance: 1500 }, true],
  ['different customer with only paid', ravi, 'Ravi', { customer: 'Imran', paid: 300 }, true],
  ['only an amount (follow-up answer)', ravi, 'Ravi', { total: 500 }, false],
  ['only a date', ravi, 'Ravi', { date: '2026-11-07' }, false],
  ['same customer, different case', ravi, 'Ravi', { customer: 'ravi', work: 'x' }, false],
  ['same customer with extra spaces', ravi, 'Ravi', { customer: '  RAVI ', total: 900 }, false],
  ['different name but no work or amount', ravi, 'Ravi', { customer: 'Asha' }, false],
  ['zero amount does not count', ravi, 'Ravi', { customer: 'Asha', total: 0 }, false],
  ['no open card', null, 'Ravi', { customer: 'Asha', work: 'brownie', total: 200 }, false],
  ['open card has empty work', { customer: 'Ravi', work: '  ' }, 'Ravi', { customer: 'Asha', work: 'brownie' }, false],
  ['nothing extracted', ravi, 'Ravi', null, false],
  ['card without customer falls back to selected customer', { customer: '', work: 'kaam' }, 'Ravi', { customer: 'Ravi', total: 100 }, false],
  ['assistant tab (no selected customer)', { customer: 'Ravi', work: 'kaam' }, null, { customer: 'Asha', work: 'cake' }, true],
];

for (const [name, pending, current, extracted, expected] of cases) {
  test(`startsNewEntry: ${name}`, () => {
    assert.equal(startsNewEntry(pending, current, extracted), expected);
  });
}

test('canonicalCustomer reuses an existing book spelling', () => {
  assert.equal(canonicalCustomer('asha', ['Asha', 'Ravi']), 'Asha');
  assert.equal(canonicalCustomer(' Meena ', ['Asha', 'Ravi']), 'Meena');
});

test('sameCustomer ignores case and surrounding spaces', () => {
  assert.equal(sameCustomer(' Asha', 'ASHA '), true);
  assert.equal(sameCustomer('Asha', 'Ashok'), false);
});

test('freshEntry uses only this message: no old date, time or paid', () => {
  const entry = freshEntry({ customer: 'Asha', work: ' brownie order ', total: 200 }, 'Asha', 'new-id', 'Asha ne brownie ka order diya 200 rupaye');
  assert.equal(entry.id, 'new-id');
  assert.equal(entry.customer, 'Asha');
  assert.equal(entry.work, 'brownie order');
  assert.equal(entry.total, 200);
  assert.equal(entry.paid, 0);
  assert.equal(entry.date, '');
  assert.equal(entry.time, '');
  assert.equal(entry.status, 'Confirmed');
  assert.equal(entry.source, 'Asha ne brownie ka order diya 200 rupaye');
});

test('freshEntry derives paid from total and balance', () => {
  const entry = freshEntry({ work: 'y', total: 2000, balance: 500 }, 'X', 'id', 's');
  assert.equal(entry.total, 2000);
  assert.equal(entry.paid, 1500);
});

test('freshEntry derives total from paid and balance', () => {
  const entry = freshEntry({ work: 'y', paid: 300, balance: 700 }, 'X', 'id', 's');
  assert.equal(entry.total, 1000);
  assert.equal(entry.paid, 300);
});

test('freshEntry ignores negative or invalid amounts', () => {
  const entry = freshEntry({ work: 'y', total: -5, paid: 'abc' }, 'X', 'id', 's');
  assert.equal(entry.total, 0);
  assert.equal(entry.paid, 0);
});

// ---------------- reply strip selection (pickEntryReply) ----------------

const me = (id, customer) => ({ id, role: 'me', customer });
const bot = (id, customer, extra = {}) => ({ id, role: 'assistant', customer, ...extra });

test('pickEntryReply: switching customer shows "Started a new entry" with Undo, even at the floor', () => {
  const turns = [
    bot('r1', 'Ravi'),
    me('m1', 'Ravi'),
    bot('started', 'Asha', { text: 'Started a new entry for Asha.', undoId: 'u1' }),
  ];
  // Floor reset onto the bubble itself (the production symptom): still shown while Undo is live.
  assert.equal(pickEntryReply(turns, 'Asha', 'started', 'u1')?.id, 'started');
  // Floor before the bubble: shown as well.
  assert.equal(pickEntryReply(turns, 'Asha', 'm1', 'u1')?.id, 'started');
  // Once Undo is no longer live, it is an ordinary old reply and the floor hides it.
  assert.equal(pickEntryReply(turns, 'Asha', 'started', 'other'), undefined);
  assert.equal(pickEntryReply(turns, 'Asha', 'started', null), undefined);
});

test('pickEntryReply: an old plain reply is hidden', () => {
  const turns = [bot('old', 'Ravi', { text: 'Entry saved ✓' }), me('opened', 'Ravi')];
  assert.equal(pickEntryReply(turns, 'Ravi', 'opened', null), undefined);
  assert.equal(pickEntryReply(turns, 'Ravi', 'old', null), undefined);
});

test('pickEntryReply: an old error without retryText is hidden', () => {
  const turns = [bot('err', 'Ravi', { text: "I couldn't finish that. Your Pakki Baat subscription is not active." }), me('opened', 'Ravi')];
  assert.equal(pickEntryReply(turns, 'Ravi', 'opened', null), undefined);
});

test('pickEntryReply: a reply with Try again is shown, even from before the floor', () => {
  const turns = [bot('retry', 'Ravi', { text: "I couldn't finish that.", retryText: 'Ravi ne 500 ka kaam diya' }), me('opened', 'Ravi')];
  assert.equal(pickEntryReply(turns, 'Ravi', 'opened', null)?.id, 'retry');
});

test('pickEntryReply: a plain reply after the floor is shown and the newest wins', () => {
  const turns = [
    bot('retry', 'Ravi', { retryText: 'x' }),
    me('opened', 'Ravi'),
    bot('fresh', 'Ravi', { text: 'Reminder set ✓' }),
  ];
  assert.equal(pickEntryReply(turns, 'Ravi', 'opened', null)?.id, 'fresh');
});

test("pickEntryReply: another customer's reply is never shown", () => {
  const turns = [me('opened', 'Ravi'), bot('asha', 'Asha', { retryText: 'x' }), bot('none', undefined, { text: 'assistant tab' })];
  assert.equal(pickEntryReply(turns, 'Ravi', 'opened', null), undefined);
});

test('pickEntryReply: with no floor, or a floor turn that is gone, every turn counts', () => {
  const turns = [bot('a', 'Ravi', { text: 'hello' })];
  assert.equal(pickEntryReply(turns, 'Ravi', null, null)?.id, 'a');
  assert.equal(pickEntryReply(turns, 'Ravi', 'trimmed-away', null)?.id, 'a');
});
