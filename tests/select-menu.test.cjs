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

test('selecting an option closes the menu and reports its value', () => {
  const source = fs.readFileSync('app/select-menu.tsx', 'utf8');
  const output = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX } }).outputText;
  const state = [], refs = []; let cursor = 0, refCursor = 0, chosen = '';
  const react = { useState(initial) { const index = cursor++; if (!(index in state)) state[index] = initial; return [state[index], value => { state[index] = typeof value === 'function' ? value(state[index]) : value; }]; }, useRef(initial) { const index = refCursor++; return refs[index] ||= { current: initial }; }, useId: () => 'test', useEffect() {}, useLayoutEffect() {} };
  const jsx = (type, props) => ({ type, props: props || {} });
  const module = { exports: {} };
  vm.runInNewContext(output, { module, exports: module.exports, require: name => name === 'react' ? react : name === 'react/jsx-runtime' ? { jsx, jsxs: jsx } : require(name) });
  const render = () => { cursor = 0; refCursor = 0; return module.exports.default({ value: chosen || 'a', onChange: value => { chosen = value; }, options: [{ value: 'a', label: 'A' }, { value: 'b', label: 'B' }], 'aria-label': 'Test' }); };
  function find(node, predicate) { if (!node || typeof node !== 'object') return undefined; if (predicate(node)) return node; const children = node.props?.children; for (const child of Array.isArray(children) ? children.flat(Infinity) : [children]) { const result = find(child, predicate); if (result) return result; } }
  for (const pointerType of ['touch', 'mouse']) {
    let tree = render(); find(tree, node => node.type === 'button').props.onClick(); tree = render();
    const option = find(tree, node => node.props?.role === 'option' && node.props.children?.[0]?.props?.children === 'B');
    assert.ok(option, pointerType); option.props.onClick({ pointerType, stopPropagation() {} });
    tree = render(); assert.equal(chosen, 'b'); assert.equal(find(tree, node => node.type === 'button').props['aria-expanded'], false); assert.equal(find(tree, node => node.props?.role === 'listbox'), undefined);
  }
});
