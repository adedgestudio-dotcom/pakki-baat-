const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const ts = require('typescript');
const React = require('react');
const { renderToStaticMarkup } = require('react-dom/server');
function load(file, mocks = {}) {
  const module = { exports: {} };
  const source = ts.transpileModule(fs.readFileSync(file, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, target: ts.ScriptTarget.ES2022, esModuleInterop: true } }).outputText;
  vm.runInNewContext(source, { module, exports: module.exports, require: name => name in mocks ? mocks[name] : require(name) });
  return module.exports;
}
const money = load('lib/money.ts');
const ui = load('app/chat-hisaab.tsx', {
  '@/lib/money': money, './simple-voice-button': () => null,
  './hisaab-entry-photo': () => null, './chat-sheet': () => null, './chat-hisaab.css': {},
});
const job = { id: 'entry-1', customer: 'Sara', work: 'Chocolate cake', total: 200, paid: 0, date: '', time: '', status: 'Waiting' };
const noop = () => {};
const bubble = (entry = job, payments = []) => renderToStaticMarkup(React.createElement(ui.ChatEntryBubble, { job: entry, number: 1, payments, onOpen: noop, onCopy: noop, onPayment: noop }));
test('entries render as accessible chat bubbles with summary and three muted actions', () => {
  const html = bubble();
  for (const text of ['Entry 1', 'Chocolate cake', 'Total', 'Pending', '0 payments', 'Add payment', 'Copy entry', 'Edit entry']) assert.ok(html.includes(text), text);
  assert.equal((html.match(/<button/g) || []).length, 4);
});
test('bottom bar has exactly clip, prominent add entry, and mode buttons', () => {
  const html = renderToStaticMarkup(React.createElement(ui.ChatBottomBar, { onClip: noop, onAdd: noop, onMode: noop, keyboard: false }));
  assert.equal((html.match(/<button/g) || []).length, 3);
  for (const text of ['Attach', 'Add entry', 'Voice entry', 'primary hisaab-add']) assert.ok(html.includes(text));
});
test('clip menu has four options and screenshot is disabled', () => {
  const element = ui.ClipMenu({ onChoose: noop });
  const html = renderToStaticMarkup(element);
  assert.equal((html.match(/<button/g) || []).length, 4);
  for (const text of ['Camera', 'Gallery', 'Paste message', 'Screenshot', 'Coming soon']) assert.ok(html.includes(text));
  assert.equal(element.props.children[3].props.disabled, true);
});
test('saving payment through existing financial planner updates pending and count on rerender', () => {
  const safety = load('lib/payment-safety.ts');
  const payment = { id: 'payment-1', jobId: job.id, customer: job.customer, amount: 50, date: '2026-11-10', note: 'Cash' };
  const next = safety.planQuickPayment({ jobs: [job], payments: [] }, job, '50', payment);
  const html = bubble(next.jobs[0], next.payments);
  assert.ok(html.includes('1 payments'));
  assert.ok(html.includes('150'));
  assert.equal(next.jobs[0].paid, 50);
});
