const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const source = fs.readFileSync(path.join(__dirname, "../app/admin/page.tsx"), "utf8");

test("owner panel retains the existing action wiring", () => {
  assert.match(source, /onConfirm:\(\)=>act\(\{action:"review_payment",paymentId:p.id,decision:"approve"\}\)/);
  assert.match(source, /onConfirm:\(\)=>act\(\{action:"review_payment",paymentId:p.id,decision:"reject"\}\)/);
  assert.match(source, /aria-label="Refresh"[^>]*onClick=\{\(\)=>void refresh\(\)\}/);
  assert.match(source, /async function refresh\(\)[\s\S]*?await load\(\)/);
  assert.match(source, /aria-label="Lock"[^>]*onClick=\{logout\}/);
  assert.match(source, /onConfirm:\(\)=>void backfillTrials\(\)/);
  assert.match(source, /fetch\("\/api\/admin\/backfill-trial-emails",\{method:"POST"\}\)/);
  assert.match(source, /fetch\("\/api\/admin\/auth",\{method:"DELETE"\}\)/);
  assert.ok(!source.includes(String.raw`\n`), "no stray literal backslash-n text");
});

test("owner panel shares payment actions and prevents duplicate submissions", () => {
  assert.match(source, /const paymentActions=/);
  assert.match(source, /p.status==="pending"&&paymentActions\(p\)/);
  assert.match(source, /if\(!begin\(body.paymentId\|\|body.userId\|\|body.action\)\)return/);
  assert.match(source, /if\(!begin\("trial-backfill"\)\)return/);
  assert.match(source, /role="status"/);
  assert.match(source, /setTimeout\(\(\)=>setToast\(""\),3000\)/);
});

test("owner panel clears errors after six seconds and on every tab switch", () => {
  assert.match(source, /useEffect\(\(\)=>\{if\(!error\)return;const timer=setTimeout\(\(\)=>setError\(""\),6000\);return\(\)=>clearTimeout\(timer\)\},\[error\]\)/);
  assert.match(source, /function switchTab\(next:string\)\{setError\(""\);setTab\(next\)\}/);
  assert.match(source, /onClick=\{\(\)=>switchTab\("payments"\)\}/);
  assert.match(source, /onClick=\{\(\)=>switchTab\(item\)\}/);
});

test("payment cards and table prefer submitted_at and show full emails", () => {
  assert.equal((source.match(/date\(p.submitted_at\|\|p.created_at\)/g) || []).length, 2);
  assert.ok(!source.includes("date(p.created_at)"));
  assert.equal((source.match(/\{p.email\|\|p.owner_id\}/g) || []).length, 2);
  assert.ok(!source.includes("maskEmail(p.email)"));
  assert.match(source, /maskEmail\(payment\?\.email\)/);
  assert.match(source, /const emailFor=.*?maskEmail\(u.email\)/);
});
