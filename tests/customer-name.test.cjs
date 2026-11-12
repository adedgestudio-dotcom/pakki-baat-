const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const ts = require('typescript');

const moduleRef = { exports: {} };
const helperSource = fs.readFileSync('lib/customer-name.ts', 'utf8');
vm.runInNewContext(ts.transpileModule(helperSource, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText, { module: moduleRef, exports: moduleRef.exports });
const { normalizeCustomerName, findExistingCustomer, rankCustomerMatches } = moduleRef.exports;

test('customer names match across case, spacing, compatibility forms and canonical accents', () => {
  assert.equal(normalizeCustomerName('  ASHA\t  K.  '), 'asha k.');
  assert.equal(findExistingCustomer('  aShA   k. ', ['Asha K.']), 'Asha K.');
  assert.equal(findExistingCustomer('ＡＳＨＡ', ['Asha']), 'Asha');
  assert.equal(findExistingCustomer('Cafe\u0301', ['Café']), 'Café');
});

test('punctuation remains significant in customer names', () => {
  for (const name of ['Asha.', 'Asha-2', 'Asha K.']) assert.equal(findExistingCustomer(name, ['Asha']), null);
  assert.equal(findExistingCustomer('asha-2', ['Asha', 'Asha-2']), 'Asha-2');
  assert.equal(findExistingCustomer('   ', ['Asha']), null);
});

test('ranked suggestions put starts-with matches first and preserve recency within each group', () => {
  const names = ['Meera', 'Asha N', 'Nasha', 'Asha', 'Kasha', 'Asha-2'];
  assert.deepEqual(Array.from(rankCustomerMatches(' ASHA ', names)), ['Asha N', 'Asha', 'Asha-2', 'Nasha', 'Kasha']);
  assert.deepEqual(Array.from(rankCustomerMatches('', names)), names);
  assert.deepEqual(Array.from(rankCustomerMatches('missing', names)), []);
});

test('new customer modal blocks duplicates and offers a live list instead of recent chips', () => {
  const source = fs.readFileSync('app/workspace.tsx', 'utf8');
  const start = source.indexOf('{newCustomerOpen && (() => {');
  const modal = source.slice(start, source.indexOf('{draft && (', start));
  assert.ok(start > 0);
  assert.match(modal, /findExistingCustomer\(newCustomerName, customerNames\)/);
  assert.match(modal, /rankCustomerMatches\(newCustomerName,/);
  assert.match(modal, /if \(findExistingCustomer\(customer, customerNames\)\) return;/);
  assert.ok(modal.indexOf('if (findExistingCustomer(customer, customerNames)) return;') < modal.indexOf('requireActiveSubscriptionForSaving()'));
  assert.match(modal, /disabled=\{!newCustomerName\.trim\(\) \|\| Boolean\(duplicateCustomer\)\}/);
  assert.match(modal, /role="alert"[^>]*>\{duplicateCustomer\} already exists/);
  assert.match(modal, /Open \{duplicateCustomer\}/);
  assert.match(modal, /matchedCustomers.length > 0/);
  assert.match(modal, /Existing customers \(\{matchedCustomers.length\}\)/);
  assert.match(modal, /matchedCustomers\.map\(name => <button/);
  assert.doesNotMatch(modal, /recent-customers|Recent customers/);
  for (const call of ['setSelectedCustomer(name)', 'setMessage("")', 'setCustomerChatOpen(false)', 'setNewCustomerOpen(false)']) assert.ok(modal.includes(call), call);
});

test('customer picker limits list height and provides dark theme styles', () => {
  const css = fs.readFileSync('app/new-customer-picker.css', 'utf8');
  assert.match(css, /max-height: min\(220px, 30dvh\); overflow-y: auto/);
  assert.match(css, /\.existing-customer-list button \{[^}]*min-height: 44px/);
  assert.match(css, /\[data-theme="dark"\] \.existing-customer-list/);
  assert.match(css, /\[data-theme="dark"\] \.new-customer-warning/);
});
