const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');

const compiled = ts.transpileModule(fs.readFileSync(path.join(__dirname, '../lib/spoken-amounts.ts'), 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText;
const mod = { exports: {} };
vm.runInNewContext(compiled, { module: mod, exports: mod.exports });
const { normalizeSpokenAmounts } = mod.exports;

const cases = [
  // Hinglish words
  ['do sau rupaye', '200 rupaye'],
  ['paanch sau', '500'],
  ['do hazaar paanch sau', '2500'],
  ['ek hazaar do sau', '1200'],
  ['dedh hazaar', '1500'],
  ['dhai sau', '250'],
  ['2 lakh', '200000'],
  ['5 hazaar advance', '5000 advance'],
  ['Do Hazaar total', '2000 total'],
  ['teen dozen ladoo, 600 rupaye, do sau diye', 'teen dozen ladoo, 600 rupaye, 200 diye'],
  ['do hazaar aur paanch sau', '2500'],
  // Devanagari digits and words
  ['₹१५००', '₹1500'],
  ['पांच सौ', '500'],
  ['दो हज़ार', '2000'],
  ['दो हज़ार', '2000'], // precomposed ज़ (U+095B)
  ['दो हज़ार', '2000'], // ज + nukta (U+091C U+093C)
  ['रवि ने 500 का काम दिया', 'रवि ने 500 का काम दिया'],
  // Must stay unchanged
  ['2l doodh', '2l doodh'],
  ['200l pani', '200l pani'],
  ['5k advance', '5k advance'],
  ['do din baad', 'do din baad'],
  ['so 500', 'so 500'],
  ['Ravi ne 500 ka kaam diya', 'Ravi ne 500 ka kaam diya'],
  ['hazaaron log', 'hazaaron log'],
];

for (const [input, expected] of cases) {
  test(`normalizeSpokenAmounts(${JSON.stringify(input)})`, () => {
    assert.equal(normalizeSpokenAmounts(input), expected);
  });
}

test('normalizeSpokenAmounts is stable on repeated calls (global regex state)', () => {
  for (let i = 0; i < 3; i++) assert.equal(normalizeSpokenAmounts('do hazaar paanch sau'), '2500');
});

test('process-message source contains no garbled rupee signs or dashes', () => {
  for (const file of ['../app/api/process-message/route.ts', '../app/api/extract/route.ts']) {
    const source = fs.readFileSync(path.join(__dirname, file), 'utf8');
    assert.ok(!source.includes('â‚¹'), `${file} has a garbled ₹`);
    assert.ok(!source.includes('â€”'), `${file} has a garbled —`);
  }
});
