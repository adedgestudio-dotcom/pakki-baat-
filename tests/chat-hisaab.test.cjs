const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const ts = require('typescript');
const React = require('react');
const { renderToStaticMarkup } = require('react-dom/server');
function load(file, mocks = {}, globals = {}) {
  const module = { exports: {} };
  const source = ts.transpileModule(fs.readFileSync(file, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, target: ts.ScriptTarget.ES2022, esModuleInterop: true } }).outputText;
  vm.runInNewContext(source, { module, exports: module.exports, require: name => name in mocks ? mocks[name] : require(name), ...globals });
  return module.exports;
}
const money = load('lib/money.ts');
const menus = load('app/chat-hisaab-menus.tsx');
const ui = load('app/chat-hisaab.tsx', {
  '@/lib/money': money, './simple-voice-button': () => null,
  './hisaab-entry-photo': () => null, './chat-sheet': () => null, './chat-hisaab.css': {}, './chat-hisaab-menus.css': {}, './chat-hisaab-menus': menus,
});
const Viewer = load('app/photo-viewer.tsx', { 'react-dom': { createPortal: element => element }, './photo-flow.css': {} }, { document: {} }).default;
const job = { id: 'entry-1', customer: 'Sara', work: 'Chocolate cake', total: 200, paid: 0, date: '', time: '', status: 'Waiting' };
const noop = () => {};
const bubble = (entry = job) => renderToStaticMarkup(React.createElement(ui.ChatEntryBubble, { job: entry, number: 1, onCopy: noop, onPayment: noop, onEdit: noop }));
test('entry cards are not buttons and show Total, Paid and Pending with three actions', () => {
  const html = bubble();
  for (const text of ['Entry 1', 'Chocolate cake', 'Total', 'Paid', 'Pending', 'Add payment', 'Copy entry', 'Edit entry']) assert.ok(html.includes(text), text);
  assert.match(html, /<div class="hisaab-bubble">/);
  assert.match(html, /<dl class="hisaab-bubble-money">/);
  assert.doesNotMatch(html, /<button class="hisaab-bubble"|Baki|0 payments/);
  assert.equal((html.match(/<button/g) || []).length, 3);
});
test('bubble pencil opens the edit form while the card body stays non-interactive', () => {
  const chat = fs.readFileSync('app/chat-hisaab.tsx', 'utf8');
  assert.match(chat, /<div className="hisaab-bubble">/);
  assert.doesNotMatch(chat, /onOpen/);
  assert.match(chat, /aria-label="Edit entry"[^>]*onClick=\{onEdit\}/);
  assert.match(chat, /onEdit=\{\(\) => ctx\.onEdit\(job\)\}/);
  assert.match(fs.readFileSync('app/chat-hisaab.css', 'utf8'), /body:has\(\.chat-hisaab\) \.modal-backdrop \{ z-index: 110/);
});
test('photo picking previews privately and POST waits for Attach photo', () => {
  const photo = fs.readFileSync('app/hisaab-entry-photo.tsx', 'utf8');
  const preview = fs.readFileSync('app/photo-preview.tsx', 'utf8');
  const change = photo.match(/onChange=\{event => \{ const file = event\.target\.files\?\.\[0\];[^\n]*/)?.[0] || '';
  assert.match(change, /setPreviewFile\(file\); setPreviewUrl\(URL\.createObjectURL\(file\)\)/);
  assert.doesNotMatch(change, /upload\(/);
  assert.match(preview, /onClick=\{onAttach\}/);
  assert.match(photo, /onAttach=\{\(\) => \{ if \(!checked\) void load\(\); else void upload\(previewFile\); \}\}/);
  assert.match(photo, /scopedFetch\(\{ method: "POST", body: form \}\)/);
});
test('photo shrink, bubble thumb and viewer share the private fetch without a bubble camera', () => {
  const photo = fs.readFileSync('app/hisaab-entry-photo.tsx', 'utf8');
  const chat = fs.readFileSync('app/chat-hisaab.tsx', 'utf8');
  const shrink = fs.readFileSync('app/shrink-photo.ts', 'utf8');
  const viewer = fs.readFileSync('app/photo-viewer.tsx', 'utf8');
  assert.match(shrink, /maxSide = 1600, quality = 0\.82/);
  assert.match(shrink, /createImageBitmap\(file, \{ imageOrientation: "from-image" \}\)/);
  assert.match(shrink, /"image\/jpeg"/);
  assert.match(photo, /if \(thumb\) return/);
  assert.match(chat, /canUpload=\{false\} canDelete=\{canDelete\} onDeleted=\{onDeleted\} thumb\//);
  assert.match(chat, /canDelete=\{ctx\.canUpload\} onDeleted=\{\(\) => ctx\.onToast\("Photo deleted"\)\}/);
  assert.doesNotMatch(chat, /countOnly|0 photos/);
  assert.equal((photo.match(/scopedFetch\(\)/g) || []).length, 1);
  assert.doesNotMatch(chat, /onCamera|openPhoto|hasPhoto|aria-label="Add photo"/);
  assert.match(viewer, /showModal/);
  assert.match(viewer, /\{onDelete && <div/);
  assert.match(viewer, /Delete this photo\? This can&apos;t be undone\./);
  assert.match(viewer, /Deleting…/);
  assert.match(photo, /scopedFetch\(\{ method: "DELETE" \}\)/);
  assert.match(photo, /Delete it first \(open the photo in the chat\), or choose another entry/);
  assert.doesNotMatch(viewer, /history\.|popstate/);
  assert.doesNotMatch(fs.readFileSync('app/chat-sheet.tsx', 'utf8'), /history\.|popstate/);
});
test('viewer offers Delete photo only when deletion is available', () => {
  const props = { open: true, src: 'blob:private-photo', onClose: noop };
  assert.doesNotMatch(renderToStaticMarkup(React.createElement(Viewer, props)), /Delete photo/);
  assert.match(renderToStaticMarkup(React.createElement(Viewer, { ...props, onDelete: async () => {} })), /Delete photo/);
});
test('Edit modal submits through save and shows every failure inline', () => {
  const workspace = fs.readFileSync('app/workspace.tsx', 'utf8');
  const modal = workspace.slice(workspace.indexOf('{draft && ('));
  const save = workspace.slice(workspace.indexOf('  function save() {'), workspace.indexOf('  const replyText ='));
  assert.match(modal, /<form\s+noValidate\s+onChangeCapture=\{\(\) => setEditError\(""\)\}/);
  assert.match(modal, /<p role="alert" className="modal-error">\{editError\}<\/p>/);
  assert.match(workspace, /onEdit=\{\(job\) => \{ savedDraftRef\.current = null; setEditError\(""\); setDraft\(job\); \}\}/);
  for (const path of ['validateEntryMoney(draft)', 'draft.customer.trim()', 'savedDraftRef.current === draft', 'requireActiveSubscriptionForSaving()', 'canAddCustomer(item.customer)', 'item.paid < previousPaid']) assert.ok(save.includes(path), path);
  assert.match(save, /const fail = \(message: string\) => \{ setEditError\(message\); setToast\(message\); \}/);
  assert.match(save, /if \(item.paid > previousPaid\) \{/);
  assert.match(save, /setJobs\(\(p\) => \[item, \.\.\.p\.filter\(\(j\) => j\.id !== item\.id\)\]\)/);
});
test('chat-only top bar, brand, and floating footer keep status above Edit', () => {
  const chat = fs.readFileSync('app/chat-hisaab.tsx', 'utf8');
  const css = fs.readFileSync('app/chat-hisaab.css', 'utf8');
  assert.match(chat, /<small className="hisaab-brand">pakki baat\.<\/small>/);
  assert.match(css, /body:has\(\.chat-hisaab\) \.topbar[^\n]*display: none !important/);
  assert.match(css, /\.hisaab-compose \{[^}]*bottom: calc\(12px \+ env\(safe-area-inset-bottom\)\)/);
  assert.match(css, /body:has\(\.chat-hisaab\) \.modal-backdrop \{ z-index: 110/);
  assert.match(css, /\.modal-backdrop > :first-child \{[^}]*max-height: calc\(100dvh - 24px\)[^}]*padding-bottom: calc\(16px \+ env\(safe-area-inset-bottom\)\)/);
  assert.match(css, /body:has\(\.chat-hisaab\) \.toast \{ z-index: 120/);
});
test('Add payment chip is replaced with Paid after full payment', () => {
  const unpaid = bubble();
  const paid = bubble({ ...job, paid: job.total });
  assert.match(unpaid, /class="hisaab-payment-chip"[^>]*>.*Add payment/);
  assert.doesNotMatch(paid, /hisaab-payment-chip/);
  assert.match(paid, /class="hisaab-paid-tag">Paid/);
});
test('entry card has no Fix amount action, even when fully paid', () => {
  assert.doesNotMatch(bubble(), /Fix amount/);
  const html = bubble({ ...job, paid: job.total });
  assert.doesNotMatch(html, /Fix amount/);
  assert.match(html, /class="hisaab-paid-tag">Paid/);
  assert.equal((html.match(/<button/g) || []).length, 2);
});
test('one payment opens correction directly; multiple payments open a newest-first chooser', () => {
  const chat = fs.readFileSync('app/chat-hisaab.tsx', 'utf8');
  assert.match(chat, /props\.payments\.filter\(payment => payment\.jobId === actionJob\.id && payment\.customer === actionJob\.customer\)/);
  assert.match(chat, /choice === "fix"\) \{ if \(actionPayments\.length === 0\) props\.onToast\("No payments to fix yet\."\); else if \(actionPayments\.length === 1\) props\.onFixPayment\(actionPayments\[0\]\); else setFixOpen\(true\)/);
  assert.match(chat, /<ChatSheet open=\{fixOpen\} label="Fix amount"/);
  assert.match(chat, /sortedPayments\.map\(payment => <button[^>]*onClick=\{\(\) => \{ setFixOpen\(false\); props\.onFixPayment\(payment\); \}\}/);
  assert.match(chat, /Date\.parse\(b\.date \|\| ""\)[^\n]*Date\.parse\(a\.date \|\| ""\)/);
  assert.match(chat, /canFix=\{props\.canFixPayments && actionPayments\.length > 0\}/);
  const css = fs.readFileSync('app/chat-hisaab.css', 'utf8');
  assert.match(css, /\.hisaab-bubble-money \{[^}]*grid-template-columns: repeat\(3, minmax\(0, 1fr\)\)/);
  assert.match(css, /\.hisaab-bubble-money \.is-pending \{ color: #9b4a2f/);
});
test('bottom bar has exactly actions, add entry, and attach with no message or mic', () => {
  const html = renderToStaticMarkup(React.createElement(ui.ChatBottomBar, { onActions: noop, onAdd: noop, onAttach: noop }));
  assert.equal((html.match(/<button/g) || []).length, 3);
  for (const text of ['Entry actions', 'Add entry', 'Attach', 'primary hisaab-add']) assert.ok(html.includes(text));
  for (const text of ['Voice entry', 'Type a message', 'Send', '<input']) assert.ok(!html.includes(text));
});
test('plus menu restores every saved entry action', () => {
  const html = renderToStaticMarkup(React.createElement(ui.EntryActionMenu, { onChoose: noop, hasEntry: true, hasHistory: true, canFix: true }));
  for (const text of ['Add photo', 'Receipt', 'WhatsApp', 'Reminder', 'Add payment', 'Fix amount', 'Edit entry', 'History of changes', 'Delete entry']) assert.ok(html.includes(text), text);
  assert.match(html, /Add payment[\s\S]*Fix amount[\s\S]*Receipt[\s\S]*Reminder[\s\S]*WhatsApp/);
  assert.equal((html.match(/<button/g) || []).length, 9);
  const unavailable = renderToStaticMarkup(React.createElement(ui.EntryActionMenu, { onChoose: noop, hasEntry: true, hasHistory: true, canFix: false }));
  assert.match(unavailable, /<button[^>]*disabled=""[^>]*>[\s\S]*?<strong>Fix amount<\/strong>/);
});
test('clip menu has four options and screenshot is disabled', () => {
  const element = ui.ClipMenu({ onChoose: noop });
  const html = renderToStaticMarkup(element);
  assert.equal((html.match(/<button/g) || []).length, 4);
  for (const text of ['Camera', 'Gallery', 'Paste message', 'Screenshot', 'Coming soon']) assert.ok(html.includes(text));
  assert.equal(element.props.children[3].props.disabled, true);
});
test('back arrow and entry detail use state-only navigation; sheet close stays in chat', () => {
  const chat = fs.readFileSync('app/chat-hisaab.tsx', 'utf8');
  const workspace = fs.readFileSync('app/workspace.tsx', 'utf8');
  const sheet = fs.readFileSync('app/chat-sheet.tsx', 'utf8');
  assert.match(chat, /aria-label="Back to Hisaab customers"[^\n]*history\.back\(\)[^\n]*props\.onBack\(\)/);
  assert.doesNotMatch(chat.match(/aria-label="Back to Hisaab customers"[^\n]*/)?.[0] || '', /onAdd|onQuick|startEntry/);
  assert.match(chat, /history\.pushState\(\{ \.\.\.history\.state, hisaabEntry: id \}, ""\)/);
  assert.match(chat, /setDetail\(history\.state\?\.hisaabEntry \|\| ""\)/);
  assert.doesNotMatch(chat, /searchParams|new URL\(location\.href\)/);
  assert.match(workspace, /restoredCustomerChatOpen = false/);
  assert.match(workspace, /customerChatOpen: false,/);
  assert.doesNotMatch(sheet, /history\.|popstate/);
  assert.match(sheet, /onCancel=\{event => \{ event\.preventDefault\(\); onClose\(\); \}\}/);
  assert.match(workspace, /const leavingChat = Boolean\(selectedCustomerRef\.current\)/);
  assert.doesNotMatch(workspace, /history\.state\?\.hisaabSheet|dialog\.hisaab-sheet\[open\]/);
});

test('camera and Gallery open the picker in the tap handler, then show selected photo preview', () => {
  const chat = fs.readFileSync('app/chat-hisaab.tsx', 'utf8');
  const photo = fs.readFileSync('app/hisaab-entry-photo.tsx', 'utf8');
  const choice = chat.slice(chat.indexOf('function chooseAction('), chat.indexOf('const closePhoto ='));
  assert.match(choice, /photoPicker\.current\.click\(\)/);
  assert.match(choice, /setAttribute\("capture", "environment"\)/);
  assert.match(choice, /removeAttribute\("capture"\)/);
  assert.doesNotMatch(choice, /setPhoto\(/);
  assert.match(chat, /<input ref=\{photoPicker\} type="file"[^\n]*onChange=\{event => \{ const file = event\.target\.files\?\.\[0\]; event\.target\.value = ""; if \(!file\) return; setPhotoFile\(file\); setPhoto\("preview"\); \}\}/);
  assert.match(chat, /initialFile=\{photoFile\} onPreviewCancel=\{closePhoto\} onAttached=/);
  assert.match(photo, /useState<File \| null>\(initialFile \|\| null\)/);
  assert.doesNotMatch(photo, /autoPick|autoPicked/);
  assert.match(chat, /props\.onToast\("Photo attached"\)/);
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
  assert.match(sheetCss, /\.chat-hisaab \.customer-phone-link \{[^}]*white-space: nowrap/);
});
test('WhatsApp banner and clean detail card keep their intended layouts', () => {
  const chatCss = fs.readFileSync('app/chat-hisaab.css', 'utf8');
  const menuCss = fs.readFileSync('app/chat-hisaab-menus.css', 'utf8');
  const workspaceCss = fs.readFileSync('app/workspace.css', 'utf8');
  const workspace = fs.readFileSync('app/workspace.tsx', 'utf8');
  const banner = chatCss.match(/\.chat-hisaab \.customer-phone-link \{[^}]*\}/)?.[0] || '';
  assert.match(banner, /width: 100%/);
  assert.match(banner, /overflow: visible/);
  assert.doesNotMatch(banner, /overflow: hidden|999px/);
  assert.doesNotMatch(menuCss + workspaceCss, /\.chat-hisaab \.customer-phone-link \{/);
  const cardStart = workspace.indexOf('return <article\n                                className="saved-detail-card customer-saved-card hisaab-history-card"');
  const card = workspace.slice(cardStart, workspace.indexOf('</article>;', cardStart));
  assert.doesNotMatch(card, /hisaab-quick-actions|hisaab-more-actions/);
  assert.doesNotMatch(card, /<HisaabEntryPhoto|viewOnly/);
  assert.doesNotMatch(chatCss, /\.hisaab-entry-page \.hisaab-(?:quick-actions|more-actions)/);
  assert.match(chatCss, /\.hisaab-chat-head button\[aria-label="More entry actions"\] \{[^}]*width: 44px; height: 44px;[^}]*color: #296445/);
  assert.match(chatCss, /\.hisaab-entry-page \.hisaab-history-summary dl \{ grid-template-columns: repeat\(3, minmax\(0, 1fr\)\)/);
  assert.match(chatCss, /\.hisaab-entry-page \.hisaab-card-statuses \{ display: grid; grid-template-columns: repeat\(2, minmax\(0, 1fr\)\)/);
  assert.doesNotMatch(fs.readFileSync('app/hisaab-entry-photo.tsx', 'utf8'), /viewOnly/);
});

test('ledger-mode entry and customer deletion do not offer impossible Undo', () => {
  const workspace = fs.readFileSync('app/workspace.tsx', 'utf8');
  for (const name of ['confirmDeleteCustomer', 'confirmDeleteEntry']) {
    const body = workspace.slice(workspace.indexOf(`async function ${name}()`), workspace.indexOf('  async function ', workspace.indexOf(`async function ${name}()`) + 1));
    assert.match(body, /if \(ledgerModeForAccount\(activeUserIdRef\.current \|\| ""\)\) setLastUndo\(null\);\s*else rememberUndo\(/);
    assert.match(body, /savePreDeleteSafetyCopy\(\)/);
  }
  assert.match(workspace, /This can&apos;t be undone\. A safety copy is saved first\./);
  assert.equal((workspace.match(/This can&apos;t be undone\. A safety copy is saved first\./g) || []).length, 2);
});

test('deleted detail auto-leaves only after its entry was seen in this chat mount', () => {
  const chat = fs.readFileSync('app/chat-hisaab.tsx', 'utf8');
  assert.match(chat, /function leaveDetail\(\) \{ if \(history\.state\?\.hisaabEntry\) history\.back\(\); else setDetail\(""\); \}/);
  assert.match(chat, /seenDetails = useRef\(new Set<string>\(\)\)/);
  assert.match(chat, /ctx\.jobs\.some\(job => job\.id === ctx\.detail\)\) seenDetails\.current\.add\(ctx\.detail\); else if \(seenDetails\.current\.delete\(ctx\.detail\)\) ctx\.leaveDetail\(\)/);
  assert.match(chat, /seenDetails\.current\.has\(ctx\.detail\) \? null : <p>This entry is no longer available\.<\/p>/);
  assert.doesNotMatch(chat, /onOpen=\{\(\) => ctx\.navigate/);
  assert.match(chat, /log\.scrollTo\(\{ top: savedScrollTop\.current \?\? log\.scrollHeight \}\); savedScrollTop\.current = null/);
});
test('saved drafts cannot reopen an entry at launch, on Hisaab, or on app focus', () => {
  const workspace = fs.readFileSync('app/workspace.tsx', 'utf8');
  assert.match(workspace, /localStorage\.removeItem\(entryDraftKey\(session\.user\.id\)\)/);
  assert.doesNotMatch(workspace, /localStorage\.getItem\(entryDraftKey/);
  assert.doesNotMatch(workspace, /restoreCurrentEntryDraft|entryDraftRestoredForUserRef/);
  assert.doesNotMatch(workspace, /addEventListener\("(?:focus|pageshow)"/);
  assert.match(workspace, /<ChatSheet open=\{customerChatOpen\}[^\n]*onClose=\{\(\) => \{[^\n]*clearEntryDraft\(\)/);
});
test('saving payment through existing financial planner updates Paid and Pending on rerender', () => {
  const safety = load('lib/payment-safety.ts');
  const payment = { id: 'payment-1', jobId: job.id, customer: job.customer, amount: 50, date: '2026-11-10', note: 'Cash' };
  const next = safety.planQuickPayment({ jobs: [job], payments: [] }, job, '50', payment);
  const html = bubble(next.jobs[0], next.payments);
  assert.ok(html.includes(money.formatMoneyRupees(50)));
  assert.ok(html.includes('150'));
  assert.equal(next.jobs[0].paid, 50);
});
