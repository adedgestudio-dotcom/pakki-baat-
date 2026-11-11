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
const menus = load('app/chat-hisaab-menus.tsx');
const ui = load('app/chat-hisaab.tsx', {
  '@/lib/money': money, './simple-voice-button': () => null,
  './hisaab-entry-photo': () => null, './chat-sheet': () => null, './chat-hisaab.css': {}, './chat-hisaab-menus.css': {}, './chat-hisaab-menus': menus,
});
const job = { id: 'entry-1', customer: 'Sara', work: 'Chocolate cake', total: 200, paid: 0, date: '', time: '', status: 'Waiting' };
const noop = () => {};
const bubble = (entry = job, payments = []) => renderToStaticMarkup(React.createElement(ui.ChatEntryBubble, { job: entry, number: 1, payments, onOpen: noop, onCopy: noop, onPayment: noop }));
test('entries render as accessible chat bubbles with summary and three muted actions', () => {
  const html = bubble();
  for (const text of ['Entry 1', 'Chocolate cake', 'Total', 'Pending', '0 payments', 'Add payment', 'Copy entry', 'Edit entry']) assert.ok(html.includes(text), text);
  assert.equal((html.match(/<button/g) || []).length, 4);
});
test('bottom bar has exactly actions, add entry, and attach with no message or mic', () => {
  const html = renderToStaticMarkup(React.createElement(ui.ChatBottomBar, { onActions: noop, onAdd: noop, onAttach: noop }));
  assert.equal((html.match(/<button/g) || []).length, 3);
  for (const text of ['Entry actions', 'Add entry', 'Attach', 'primary hisaab-add']) assert.ok(html.includes(text));
  for (const text of ['Voice entry', 'Type a message', 'Send', '<input']) assert.ok(!html.includes(text));
});
test('plus menu restores every saved entry action', () => {
  const html = renderToStaticMarkup(React.createElement(ui.EntryActionMenu, { onChoose: noop, hasEntry: true, hasHistory: true }));
  for (const text of ['Add photo', 'Receipt', 'WhatsApp', 'Reminder', 'Add payment', 'Edit entry', 'History of changes', 'Delete entry']) assert.ok(html.includes(text), text);
  assert.equal((html.match(/<button/g) || []).length, 8);
});
test('clip menu has four options and screenshot is disabled', () => {
  const element = ui.ClipMenu({ onChoose: noop });
  const html = renderToStaticMarkup(element);
  assert.equal((html.match(/<button/g) || []).length, 4);
  for (const text of ['Camera', 'Gallery', 'Paste message', 'Screenshot', 'Coming soon']) assert.ok(html.includes(text));
  assert.equal(element.props.children[3].props.disabled, true);
});
test('back arrow clears customer without opening entry and sheet close consumes history', () => {
  const chat = fs.readFileSync('app/chat-hisaab.tsx', 'utf8');
  const workspace = fs.readFileSync('app/workspace.tsx', 'utf8');
  const sheet = fs.readFileSync('app/chat-sheet.tsx', 'utf8');
  assert.match(chat, /aria-label="Back to Hisaab customers"[^\n]*props\.onBack\(\)/);
  assert.doesNotMatch(chat.match(/aria-label="Back to Hisaab customers"[^\n]*/)?.[0] || '', /onAdd|onQuick|startEntry/);
  assert.match(workspace, /restoredCustomerChatOpen = false/);
  assert.match(workspace, /customerChatOpen: false,/);
  assert.match(sheet, /history\.back\(\)/);
  assert.match(sheet, /popstate/);
});
test('entry tabs remount one content branch and the sheet has one scroller', () => {
  const workspace = fs.readFileSync('app/workspace.tsx', 'utf8');
  const css = fs.readFileSync('app/chat-hisaab-menus.css', 'utf8');
  const sheetCss = fs.readFileSync('app/chat-hisaab.css', 'utf8');
  assert.match(workspace, /<div key=\{entryMode\}>\s*\{entryMode === "quick" \? \(/);
  assert.match(workspace, /scrollKey=\{entryMode\}/);
  assert.match(sheetCss, /\.hisaab-sheet-content \{[^}]*overflow-y: auto/);
  assert.match(sheetCss, /\.hisaab-sheet \{[^}]*overflow: hidden/);
  assert.doesNotMatch(css + sheetCss, /\.hisaab-sheet[^{}]*\{[^{}]*position:\s*sticky/);
  assert.match(css, /\.chat-hisaab \.customer-phone-link \{[^}]*white-space: nowrap/);
});
test('saved drafts cannot reopen an entry at launch, on Hisaab, or on app focus', () => {
  const workspace = fs.readFileSync('app/workspace.tsx', 'utf8');
  assert.match(workspace, /localStorage\.removeItem\(entryDraftKey\(session\.user\.id\)\)/);
  assert.doesNotMatch(workspace, /localStorage\.getItem\(entryDraftKey/);
  assert.doesNotMatch(workspace, /restoreCurrentEntryDraft|entryDraftRestoredForUserRef/);
  assert.doesNotMatch(workspace, /addEventListener\("(?:focus|pageshow)"/);
  assert.match(workspace, /<ChatSheet open=\{customerChatOpen\}[^\n]*onClose=\{\(\) => \{[^\n]*clearEntryDraft\(\)/);
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
