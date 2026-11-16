const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const ts = require('typescript');
const vm = require('node:vm');

test('clock conversion handles noon, midnight and clamped minutes', () => {
  const source = fs.readFileSync('app/cloud-settings.tsx', 'utf8');
  const functions = source.slice(source.indexOf('export function clampClockMinute'), source.indexOf('function ClockPicker'));
  const output = ts.transpileModule(functions, { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText;
  const exports = {};
  vm.runInNewContext(output, { exports });
  assert.equal(exports.clockTime24(12, 7, 'AM'), '00:07');
  assert.equal(exports.clockTime24(12, 7, 'PM'), '12:07');
  assert.equal(exports.clockTime24(9, 5, 'PM'), '21:05');
  assert.equal(exports.clampClockMinute(-1), 0);
  assert.equal(exports.clampClockMinute(60), 59);
});
