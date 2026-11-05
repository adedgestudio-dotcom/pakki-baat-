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
const { startsNewEntry, canonicalCustomer, freshEntry, sameCustomer } = mod.exports;

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
