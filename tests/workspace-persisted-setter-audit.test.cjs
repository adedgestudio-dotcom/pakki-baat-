/* eslint-disable @typescript-eslint/no-require-imports */
const test = require("node:test"), assert = require("node:assert/strict"), fs = require("node:fs"), path = require("node:path");
const baseline = [541,542,782,783,784,785,786,787,788,1656,1864,1865,1866,1867,1868,1986,2029,2054,2056,2098,2101,2169,2172,2220,2222,2595,2596,2597,2598,2599,2600,2601,2621,2702,2703,2720,2744,2745,2746,2747,2749,2764,2765,2766,2807,2835,2836,2837,2838,2839,2840,2841,2950,2990,3052,4545,4693];
test("persisted workspace setters match the explicit migration baseline", () => {
  const source = fs.readFileSync(path.join(__dirname, "../app/workspace.tsx"), "utf8");
  const found = source.split(/\r?\n/).flatMap((line, index) => /\bset(Jobs|Payments|Reminders|Notes|CustomerPhones|Owner|Business)\s*\(/.test(line) ? [index + 1] : []);
  assert.deepEqual(found, baseline, "New direct persisted setters require an explicit audit update; migrations must remove their baseline entries.");
});
