const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const read = name => fs.readFileSync(path.join(__dirname, "../app", name), "utf8");

test("every saved-entry action remains reachable from its card", () => {
  const source = read("workspace.tsx");
  const start = source.indexOf('return <article\n                                className="saved-detail-card customer-saved-card hisaab-history-card"');
  const end = source.indexOf("</article>;", start);
  assert.ok(start > 0 && end > start);
  const card = source.slice(start, end);
  const quick = card.slice(card.indexOf('<div className="hisaab-quick-actions"'), card.indexOf('<details className="hisaab-more-details"'));
  const more = quick.slice(quick.indexOf('<details className="hisaab-more-actions"'));
  const detail = card.slice(card.indexOf('<details className="hisaab-more-details"'));
  for (const [label, handler] of [
    ["Add payment", "openPayment(j)"], ["Photos", 'details.open = true'],
    ["Edit", "setDraft(j)"], ["Remind", "openReminder(j)"],
  ]) { assert.ok(quick.includes(label), label); assert.ok(quick.includes(handler), handler); }
  for (const [label, handler] of [
    ["Receipt", "openReceipt(j)"], ["WhatsApp", "openWhatsApp(j)"],
    ["History", 'setTab("Reports")'], ["Delete", "deleteEntry(j)"],
  ]) { assert.ok(more.includes(label), label); assert.ok(more.includes(handler), handler); }
  assert.ok(detail.includes("More details"));
  assert.ok(detail.includes("Payments ({entryPayments.length})"));
  for (const action of ["<HisaabEntryPhoto", "<HisaabPayments", "onCorrect={openEditPayment}", 'updateJobStatus(j, "Waiting")', 'updateJobStatus(j, "Confirmed")', 'updateJobStatus(j, "Completed")']) assert.ok(detail.includes(action), action);
  assert.ok(read("hisaab-entry-photo.tsx").includes("No photos yet. Tap Add photo."));
});

test("quick actions are large, wrap on phones and retain readable card surfaces", () => {
  const css = read("workspace.css");
  assert.ok(css.includes(".hisaab-quick-actions>.card-action,.customer-saved-card .hisaab-more-actions>summary{min-width:0;min-height:44px"));
  assert.ok(css.includes("@media(max-width:560px){.hisaab-history-card .hisaab-quick-actions{grid-template-columns:repeat(2,minmax(0,1fr))"));
  assert.ok(css.includes(".hisaab-history-card{background:#fffaf2;border-color:#d6d4ca"));
  assert.ok(css.includes('[data-theme="dark"] .hisaab-history-card{background:#17271f;border-color:#43584a'));
});
