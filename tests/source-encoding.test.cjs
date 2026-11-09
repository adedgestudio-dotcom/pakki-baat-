const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

// Sources changed by reports-fixes. Keep this list independent of Git refs so
// the checks also run in source archives and after the branch has been merged.
const changedSources = [
  "app/api/process-message/route.ts",
  "app/reports-detail.tsx", "app/reports-groups.tsx", "app/reports-mobile.tsx",
  "app/reports-print.tsx", "app/reports.css", "app/reports.tsx",
  "app/workspace.css", "app/workspace.tsx",
  "lib/cloud.ts", "lib/reports-groups.ts", "lib/reports-ui.ts", "lib/reports.ts",
  "scripts/eval-assistant.mjs",
  "tests/customer-footer.test.cjs", "tests/reports-fixes.test.cjs",
  "tests/reports-grouping.test.cjs", "tests/install-prompt.test.cjs",
  "tests/source-encoding.test.cjs",
];
test("changed Reports source files are valid UTF-8 without BOM or replacement characters", () => {
  const decoder = new TextDecoder("utf-8", { fatal: true });
  for (const relative of changedSources) {
    const bytes = fs.readFileSync(path.join(__dirname, "..", relative));
    assert.ok(!bytes.subarray(0, 3).equals(Buffer.from([0xef, 0xbb, 0xbf])), relative + " has a UTF-8 BOM");
    const text = decoder.decode(bytes);
    assert.ok(!text.includes(String.fromCharCode(0xfffd)), relative + " contains U+FFFD");
  }
});
