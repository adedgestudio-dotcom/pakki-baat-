const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const read = name => fs.readFileSync(path.join(__dirname, "../app", name), "utf8");

test("saved-entry detail is information only, with actions in the header plus sheet", () => {
  const source = read("workspace.tsx");
  const start = source.indexOf('return <article\n                                className="saved-detail-card customer-saved-card hisaab-history-card"');
  const end = source.indexOf("</article>;", start);
  assert.ok(start > 0 && end > start);
  const card = source.slice(start, end);
  assert.ok(!card.includes('hisaab-quick-actions'));
  assert.ok(!card.includes('hisaab-more-actions'));
  const detail = card.slice(card.indexOf('<details className="hisaab-more-details"'));
  for (const text of ['hisaab-entry-number', 'saved-entry-created-date', 'Total', 'Received', 'Baki', 'Work:', 'Payment:', 'Due:']) assert.ok(card.includes(text), text);
  assert.ok(detail.includes("More details"));
  assert.ok(detail.includes("Payments ({entryPayments.length})"));
  assert.ok(!detail.includes("<HisaabEntryPhoto"));
  for (const action of ["<HisaabPayments", "onCorrect={openEditPayment}", 'updateJobStatus(j, "Waiting")', 'updateJobStatus(j, "Confirmed")', 'updateJobStatus(j, "Completed")']) assert.ok(detail.includes(action), action);
  assert.ok(read("chat-hisaab.tsx").includes('aria-label="More entry actions"'));
});

test("detail card retains readable amounts and status rows", () => {
  const css = read("workspace.css");
  const chatCss = read("chat-hisaab.css");
  assert.ok(chatCss.includes(".hisaab-entry-page .hisaab-history-summary dl { grid-template-columns: repeat(3, minmax(0, 1fr));"));
  assert.ok(chatCss.includes(".hisaab-entry-page .hisaab-card-statuses { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr));"));
  assert.ok(!chatCss.includes(".hisaab-entry-page .hisaab-quick-actions"));
  assert.ok(css.includes(".hisaab-history-card{background:#fffaf2;border-color:#d6d4ca"));
  assert.ok(css.includes('[data-theme="dark"] .hisaab-history-card{background:#17271f;border-color:#43584a'));
});
