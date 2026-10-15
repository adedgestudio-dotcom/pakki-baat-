/* eslint-disable @typescript-eslint/no-require-imports */
const test = require("node:test"), assert = require("node:assert/strict"), fs = require("node:fs"), path = require("node:path");
const baseline = [503,504,741,742,743,744,745,746,747,1592,1800,1801,1802,1803,1804,1922,1965,1990,1992,2034,2037,2105,2108,2156,2158,2530,2531,2532,2533,2534,2535,2536,2556,2637,2638,2655,2679,2680,2681,2682,2684,2699,2700,2701,2742,2770,2771,2772,2773,2774,2775,2776,2883,2923,2985,4478,4626];
test("persisted workspace setters match the explicit migration baseline", () => {
  const source = fs.readFileSync(path.join(__dirname, "../app/workspace.tsx"), "utf8");
  const found = source.split(/\r?\n/).flatMap((line, index) => /\bset(Jobs|Payments|Reminders|Notes|CustomerPhones|Owner|Business)\s*\(/.test(line) ? [index + 1] : []);
  assert.deepEqual(found, baseline, "New direct persisted setters require an explicit audit update; migrations must remove their baseline entries.");
});
