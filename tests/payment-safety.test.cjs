const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');
const { webcrypto } = require('node:crypto');
const source = fs.readFileSync(path.join(__dirname, '../app/workspace.tsx'), 'utf8');
const compiled = text => ts.transpileModule(text, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
const safetyModule = { exports: {} };
vm.runInNewContext(compiled(fs.readFileSync(path.join(__dirname, '../lib/payment-safety.ts'), 'utf8')), { module: safetyModule, exports: safetyModule.exports, Error });
const safety = safetyModule.exports;
const ast = ts.createSourceFile('workspace.tsx', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
const functions = new Map();
function visit(node) {
  if (ts.isFunctionDeclaration(node) && node.name) functions.set(node.name.text, node.getText(ast));
  ts.forEachChild(node, visit);
}
visit(ast);
function harness() {
  const job = { id: 'j', customer: 'Synthetic', work: 'Repair', total: 100, paid: 20, date: '', time: '', status: 'Confirmed', source: 'test' };
  const payment = { id: 'p', jobId: 'j', customer: job.customer, amount: 20, date: '2026-11-01', createdAt: '2026-11-01T00:00:00Z' };
  const context = {
    ...safety, Error, crypto: webcrypto,
    financialStateRef: { current: { jobs: [job], payments: [payment] } },
    activeUserIdRef: { current: 'owner-a' }, workspaceUserIdRef: { current: 'owner-a' },
    cloudWriteConflictForAccount: () => false, ledgerModeForAccount: () => true,
    LEGACY_WORKSPACE_READ_ONLY_MESSAGE: "This workspace is read-only until safe, revision-checked saving is available. Your existing records are preserved.",
    requireActiveSubscriptionForSaving: () => true,
    submittedPaymentJobRef: { current: null }, paymentJob: job, paymentAmount: '30',
    editingPayment: payment, editPaymentAmount: '10', editPaymentReason: 'wrong_amount', editPaymentNote: '',
    publishJobs: value => { context.visibleJobs = value; }, publishPayments: value => { context.visiblePayments = value; },
    setToast: value => { context.toast = value; }, rememberUndo: () => {},
    // Leave the old closure intact to reproduce a second submission before React renders.
    setPaymentJob: () => {}, setPaymentAmount: () => {}, closeEditPayment: () => {}, day: () => '2026-11-01',
  };
  vm.createContext(context);
  for (const name of ['setJobs', 'setPayments', 'confirmFinancialWrite', 'applyFinancialState', 'saveQuickPayment', 'savePaymentCorrection']) {
    assert.ok(functions.has(name), name);
    vm.runInContext(compiled(functions.get(name)), context);
  }
  return context;
}
for (const value of ['0.001', '1.001', '-1', '', ' ', '1e2', 'NaN', 'Infinity', '1,00', '9007199254740992']) {
  test(`exact paise parser rejects ${JSON.stringify(value)}`, () => assert.throws(() => safety.paymentPaise(value)));
}
test('exact paise parser retains valid zero, one paise and decimal amounts', () => {
  for (const [input, paise] of [['0', 0], ['0.00', 0], ['0.01', 1], ['.01', 1], ['1', 100], ['1.10', 110], ['0.10', 10], ['1.99', 199], ['12345.67', 1234567]]) assert.equal(safety.paymentPaise(input), paise);
});
test('one-paise payment updates job, payment history and baki exactly', () => {
  const h = harness(); h.paymentAmount = '0.01'; h.saveQuickPayment();
  assert.equal(h.financialStateRef.current.jobs[0].paid, 20.01);
  assert.equal(h.financialStateRef.current.payments[0].amount, 0.01);
});
test('stale dialog rejects changed received amount before any state mutation', () => {
  const h = harness(); h.setJobs(items => items.map(j => ({ ...j, paid: 90 })));
  const before = JSON.stringify(h.financialStateRef.current); h.saveQuickPayment();
  assert.equal(JSON.stringify(h.financialStateRef.current), before); assert.match(h.toast, /changed/);
});
test('stale dialog rejects charge reduction, deleted job and account reassignment', () => {
  for (const jobs of [[], [{ id: 'j', customer: 'Other', total: 100, paid: 20 }], [{ id: 'j', customer: 'Synthetic', total: 25, paid: 20 }]]) {
    const h = harness(); h.setJobs(jobs); h.saveQuickPayment(); assert.equal(h.financialStateRef.current.payments.length, 1); assert.match(h.toast, /changed/);
  }
});
test('fractional-paise payment and zero payment fail without mutation', () => {
  for (const amount of ['0.001', '0', '0.00']) {
    const h = harness(); h.paymentAmount = amount; h.saveQuickPayment(); assert.equal(h.financialStateRef.current.jobs[0].paid, 20); assert.equal(h.financialStateRef.current.payments.length, 1);
  }
});
test('overpayment fails without silently capping', () => {
  const h = harness(); h.paymentAmount = '80.01'; h.saveQuickPayment(); assert.equal(h.financialStateRef.current.jobs[0].paid, 20); assert.match(h.toast, /exceeds/);
});
test('duplicate click before a render records exactly one payment', () => {
  const h = harness(); h.saveQuickPayment(); h.saveQuickPayment(); assert.equal(h.financialStateRef.current.jobs[0].paid, 50); assert.equal(h.financialStateRef.current.payments.length, 2);
});
test('two dialogs submitted before a render cannot reuse the old balance', () => {
  const h = harness(); const other = { ...h.paymentJob }; h.saveQuickPayment(); h.paymentJob = other; h.saveQuickPayment();
  assert.equal(h.financialStateRef.current.jobs[0].paid, 50); assert.equal(h.financialStateRef.current.payments.length, 2); assert.match(h.toast, /changed/);
});
test('new submission against latest state adds exact decimal amounts', () => {
  const h = harness(); h.paymentAmount = '0.10'; h.saveQuickPayment(); h.paymentJob = h.financialStateRef.current.jobs[0]; h.paymentAmount = '0.20'; h.saveQuickPayment(); assert.equal(h.financialStateRef.current.jobs[0].paid, 20.3);
});
test('payment-history mismatch and duplicate ID are rejected', () => {
  const h = harness(); h.setPayments([]); h.saveQuickPayment(); assert.match(h.toast, /history/);
  const a = harness(); assert.throws(() => safety.planQuickPayment(a.financialStateRef.current, a.paymentJob, '20', a.editingPayment), /Duplicate/);
});
test('known revision conflict and account switch block local payment and correction', () => {
  for (const mode of ['conflict', 'account']) {
    const h = harness(); if (mode === 'conflict') h.cloudWriteConflictForAccount = () => true; else h.activeUserIdRef.current = 'owner-b';
    h.saveQuickPayment(); h.savePaymentCorrection(); assert.equal(h.financialStateRef.current.jobs[0].paid, 20); assert.equal(h.financialStateRef.current.payments.length, 1);
  }
});
test('correction to one paise and zero removal retain ledger-compatible history', () => {
  for (const amount of ['0.01', '0']) {
    const h = harness(); h.editPaymentAmount = amount; h.savePaymentCorrection();
    assert.equal(h.financialStateRef.current.jobs[0].paid, Number(amount));
    assert.equal(h.financialStateRef.current.payments.length, amount === '0' ? 0 : 1);
  }
});
test('invalid correction and stale correction cannot change balances', () => {
  for (const amount of ['0.001', '-1', '', '101']) { const h = harness(); h.editPaymentAmount = amount; h.savePaymentCorrection(); assert.equal(h.financialStateRef.current.jobs[0].paid, 20); }
  const h = harness(); h.setPayments(items => items.map(p => ({ ...p, amount: 15 }))); h.savePaymentCorrection(); assert.match(h.toast, /changed/); assert.equal(h.financialStateRef.current.jobs[0].paid, 20);
});
test('correction double submission cannot repeat an old correction', () => {
  const h = harness(); h.savePaymentCorrection(); h.savePaymentCorrection(); assert.equal(h.financialStateRef.current.jobs[0].paid, 10); assert.match(h.toast, /changed/);
});
test('entry validation rejects fractional charges and advances but permits zero', () => {
  assert.throws(() => safety.validateEntryMoney({ total: 1.001, paid: 0 }));
  assert.throws(() => safety.validateEntryMoney({ total: 1, paid: 0.001 }));
  assert.doesNotThrow(() => safety.validateEntryMoney({ total: 0, paid: 0 }));
  for (const name of ['savePendingEntry', 'finishCustomerChat', 'save']) assert.match(functions.get(name), /validateEntryMoney/);
});


test('PB-04 legacy payment and correction fail before changing local financial state', () => {
  const h = harness(); h.ledgerModeForAccount = () => false;
  h.saveQuickPayment(); h.savePaymentCorrection();
  assert.equal(h.financialStateRef.current.jobs[0].paid, 20);
  assert.equal(h.financialStateRef.current.payments.length, 1);
  assert.match(h.toast, /read-only/);
});

test('PB-04 real edit gate rejects legacy and unknown modes even on an active plan', () => {
  for (const allowed of [false, true]) {
    const h = harness(); h.requireLoginForSaving = () => true; h.hasActiveSubscription = true;
    h.ledgerModeForAccount = () => allowed;
    vm.runInContext(compiled(functions.get('requireActiveSubscriptionForSaving')), h);
    assert.equal(h.requireActiveSubscriptionForSaving(), allowed);
    if (!allowed) assert.match(h.toast, /read-only/);
  }
  assert.match(source, /aria-label="Workspace read-only"/);
});
