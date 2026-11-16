const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const ts = require('typescript');
const vm = require('node:vm');

test('options retain their values and labels in their groups', () => {
  const source = fs.readFileSync('app/select-menu.tsx', 'utf8');
  const output = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX } }).outputText;
  const module = { exports: {} };
  vm.runInNewContext(output, { module, exports: module.exports, require });
  const options = [{ value: 'a', label: 'Alpha', group: 'First' }, { value: 'b', label: 'Beta' }, { value: 'c', label: 'Gamma', group: 'First' }];
  assert.deepEqual(JSON.parse(JSON.stringify(module.exports.groupSelectOptions(options))), [
    { label: 'First', options: [options[0], options[2]] },
    { options: [options[1]] },
  ]);
});
