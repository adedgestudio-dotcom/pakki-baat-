const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');
const React = require('react');
const { renderToStaticMarkup } = require('react-dom/server');
const root = path.join(__dirname, '..');
function load(file, dependencies = {}) {
  const module = { exports: {} };
  const code = ts.transpileModule(fs.readFileSync(path.join(root, file), 'utf8'), {
    compilerOptions: { jsx: ts.JsxEmit.React, module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  vm.runInNewContext(code, { module, exports: module.exports, React, Intl, Error,
    require(name) { assert.ok(Object.hasOwn(dependencies, name), name); return dependencies[name]; },
  });
  return module.exports;
}
const money = load('lib/money.ts');
const reports = load('lib/reports.ts', { './money': money });
const data = load('lib/data.ts', { './money': money });
const Payments = load('app/hisaab-payments.tsx', { '@/lib/money': money }).default;
const workspace = fs.readFileSync(path.join(root, 'app/workspace.tsx'), 'utf8');
const ast = ts.createSourceFile('workspace.tsx', workspace, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
const functions = new Map();
const expressions = new Map();
function visit(node) {
  if (ts.isFunctionDeclaration(node) && node.name) functions.set(node.name.text, node.getText(ast));
  if (ts.isVariableDeclaration(node) && ['replyText', 'receiptText', 'receiptNumber'].includes(node.name.getText(ast))) expressions.set(node.name.getText(ast), node.initializer.getText(ast));
  ts.forEachChild(node, visit);
}
visit(ast);
const context = { money: money.formatMoneyRupees, business: 'Synthetic shop' };
vm.createContext(context);
vm.runInContext(ts.transpileModule(`${[...expressions].map(([name, value]) => `var ${name} = ${value};`).join('\n')}\n${['receiptNumber','receiptText','escapeReceiptHtml','receiptHtml'].filter(n => functions.has(n)).map(n => functions.get(n)).join('\n')}`, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText, context);
const job = paid => ({ id: 'j', customer: 'Synthetic', work: 'Repair', total: 100, paid, date: '2026-11-01', time: '', status: 'Confirmed', source: 'test' });

for (const [rupees, paise, text] of [[0.01, 1, '₹0.01'], [20.10, 2010, '₹20.10'], [65.01, 6501, '₹65.01'], [99.99, 9999, '₹99.99']]) {
  test(`PB-02 currency, Reports, receipt and WhatsApp retain ${text}`, () => {
    assert.equal(money.formatMoneyPaise(paise), text);
    assert.equal(money.formatMoneyRupees(rupees), text);
    assert.equal(reports.formatReportMoney(paise), text);
    assert.ok(context.receiptText(job(rupees)).includes(`Received: ${text}`));
    assert.ok(context.replyText(job(rupees)).includes(`Received: ${text}`));
    const payment = { id: 'p', amount: rupees, date: '2026-11-01', customer: 'Synthetic', jobId: 'j' };
    const html = renderToStaticMarkup(React.createElement(Payments, { payments: [payment], readOnly: false, onCorrect() {} }));
    assert.ok(html.includes(text));
  });
}
test('PB-02 balances, zeros, negatives and Indian grouping retain two decimals', () => {
  assert.equal(money.formatMoneyRupees(100 - 65.01), '₹34.99');
  assert.equal(money.formatMoneyRupees(0.3 - 0.2), '₹0.10');
  assert.equal(money.formatMoneyRupees(0), '₹0.00');
  assert.equal(money.formatMoneyPaise(-2010), '-₹20.10');
  assert.equal(money.formatMoneyPaise(123456789), '₹12,34,567.89');
  assert.equal(money.paiseDecimal(Number.MAX_SAFE_INTEGER), '90071992547409.91');
  for (const invalid of [NaN, Infinity, 0.1, Number.MAX_SAFE_INTEGER + 1]) assert.throws(() => money.formatMoneyPaise(invalid));
});
test('PB-02 calendar and reminder message use the shared formatter', () => {
  assert.ok(data.calendarFile(job(65.01)).includes('Balance to collect: ₹34.99'));
  assert.match(workspace, /const money = formatMoneyRupees/);
  assert.doesNotMatch(workspace, /baki\.toLocaleString|maximumFractionDigits:\s*0/);
});
function buttons(element, output = []) {
  if (!element || typeof element !== 'object') return output;
  if (element.type === 'button') output.push(element);
  React.Children.forEach(element.props?.children, child => buttons(child, output));
  return output;
}
test('PB-01 visible payment row invokes the existing correction handler with its exact record', () => {
  const payment = { id: 'p', customer: 'Synthetic', jobId: 'j', amount: 30, date: '2026-11-01' };
  let corrected, audit = 0;
  const tree = Payments({ payments: [payment], readOnly: false, onCorrect: p => { corrected = p; }, onViewLedger: () => audit++ });
  const actions = buttons(tree);
  actions.find(b => b.props.children === 'Fix amount').props.onClick();
  actions.find(b => b.props.children === 'See history of changes').props.onClick();
  assert.equal(corrected, payment); assert.equal(audit, 1);
  const historyStart = workspace.indexOf('<h2>History</h2>');
  const historyEnd = workspace.indexOf('</article>;', historyStart);
  assert.match(workspace.slice(historyStart, historyEnd), /<HisaabPayments[\s\S]*onCorrect=\{openEditPayment\}/);
  assert.match(workspace.slice(historyStart, historyEnd), /payment\.jobId === j\.id && payment\.customer === j\.customer/);
});
test('PB-01 legacy/conflicted rows are disabled and correction rationale is visible', () => {
  const props = { payments: [{ id: 'p', amount: 25, date: '2026-11-01', correctionReason: 'wrong_amount', correctionNote: 'Confirmed with customer' }], readOnly: true, onCorrect() {} };
  const tree = Payments(props);
  assert.equal(buttons(tree)[0].props.disabled, true);
  const html = renderToStaticMarkup(React.createElement(Payments, props));
  assert.ok(html.includes('₹25.00')); assert.ok(html.includes('Corrected · Wrong amount · Confirmed with customer'));
});
test('PB-01 removed payment retains access to immutable ledger history', () => {
  const html = renderToStaticMarkup(React.createElement(Payments, { payments: [], readOnly: false, onCorrect() {}, onViewLedger() {} }));
  assert.ok(html.includes('No payment records')); assert.ok(html.includes('See history of changes'));
  assert.ok(!html.includes('Fix amount'));
});
test('PB-01 correction ledger reconciles with History, Reports and CSV without discarding original events', () => {
  const owner = 'synthetic-owner';
  const event = (id, kind, amount, reverse = null) => ({ id, owner_id: owner, job_id: 'j', customer_name: 'Synthetic', transaction_kind: kind, amount_paise: amount, occurred_at: '2026-11-01T12:00:00Z', reverses_transaction_id: reverse, metadata: { reason: 'payment_edit' } });
  const rows = [event('charge', 'charge', 10000), event('original', 'payment', 3000), event('reverse', 'reversal', 3000, 'original'), event('corrected', 'payment', 2500)];
  const report = reports.ledgerReport(rows, owner, { jobs: [job(25)], owner: 'Synthetic', business: 'Shop' });
  const view = reports.selectReport(report, reports.defaultReportFilter);
  assert.equal(view.sales, 10000); assert.equal(view.payments, 2500); assert.equal(view.periodBalance, 7500);
  assert.equal(report.activeOutstandingPaise, 7500); assert.equal(report.warnings.length, 0); assert.equal(report.rows.length, 4);
  const csv = reports.reportCsv(report.rows);
  assert.ok(csv.includes('"25.00"')); assert.ok(csv.includes('"-30.00"'));
  assert.equal(rows.length, 4);
});
