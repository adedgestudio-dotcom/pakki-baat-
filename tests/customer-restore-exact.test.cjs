const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const ts = require('typescript');

function load(file, mocks = {}) {
  const module = { exports: {} };
  const source = ts.transpileModule(fs.readFileSync(file, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  vm.runInNewContext(source, { module, exports: module.exports, require: name => mocks[name] || require(name), Set, Map, Date, Intl });
  return module.exports;
}

const names = load('lib/customer-name.ts');
const { sliceCustomer, restoreCustomer } = load('lib/customer-backup.ts', { './customer-name': names });
const job = (id, customer) => ({ id, customer, work: 'Cake', total: 100, paid: 0, date: '2026-11-10', time: '', status: 'Waiting', source: '' });
const original = { owner: 'Owner', business: 'Shop', jobs: [job('j1', 'Basha'), job('j2', 'Basha'), job('j3', 'Basha'), job('other', 'Basha.')], payments: [], notes: [], reminders: [], customerPhones: {} };
const saved = sliceCustomer(original, 'Basha');
const current = { ...original, jobs: [...original.jobs, job('j4', 'Basha')] };

test('restore replaces four current entries with exactly three backup entries and leaves Basha. untouched', () => {
  const result = restoreCustomer(current, saved);
  assert.deepEqual(Array.from(result.snapshot.jobs, row => row.id), ['other', 'j1', 'j2', 'j3']);
  assert.deepEqual(result.snapshot.jobs.find(row => row.customer === 'Basha.'), original.jobs[3]);
  assert.deepEqual(Array.from(current.jobs, row => row.id), ['j1', 'j2', 'j3', 'other', 'j4']);
});

test('a backup containing a later-deleted historical ID throws without changing the workspace', () => {
  const deleted = { ...current, jobs: current.jobs.filter(row => row.id !== 'j2') };
  const before = JSON.stringify(deleted);
  assert.throws(() => restoreCustomer(deleted, saved, new Set(['j2']), new Set()),
    /This backup contains entries that were deleted later and can't be restored exactly\. Nothing was changed\./);
  assert.equal(JSON.stringify(deleted), before);
});
