const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const ts = require('typescript');
const source = ts.transpileModule(fs.readFileSync('lib/pending-delete.ts', 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText;
const moduleObject = { exports: {} };
vm.runInNewContext(source, { module: moduleObject, exports: moduleObject.exports, setTimeout, clearTimeout });
const { createPendingDeleteController, withoutPendingDelete } = moduleObject.exports;

function setup() {
  const saved = { jobs: [{ id: 'a', customer: 'A' }, { id: 'b', customer: 'B' }], payments: [{ jobId: 'a', customer: 'A' }, { jobId: 'b', customer: 'B' }], reminders: [{ jobId: 'a', customer: 'A' }], notes: [{ customer: 'A' }], customerPhones: { A: '123', B: '456' }, owner: '', business: '' };
  let current = saved, visible = saved, pending = null, scheduled, saves = 0, delay;
  const controller = createPendingDeleteController(item => { current = withoutPendingDelete(current, item); saves++; }, item => { pending = item; visible = withoutPendingDelete(current, item); }, (fn, ms) => { scheduled = fn; delay = ms; return 1; }, () => { scheduled = null; });
  return { controller, get current() { return current; }, get visible() { return visible; }, get pending() { return pending; }, get saves() { return saves; }, get delay() { return delay; }, timeout() { scheduled(); } };
}

test('undo restores the display without saving', () => {
  const h = setup(); h.controller.start({ type: 'entry', id: 'a' });
  assert.equal(h.delay, 10000); assert.equal(h.current.jobs.length, 2); assert.equal(h.visible.jobs.length, 1); assert.equal(h.visible.payments.length, 1);
  h.controller.undo(); assert.equal(h.saves, 0); assert.equal(h.visible.jobs.length, 2); assert.equal(h.pending, null);
});
test('timeout applies the customer deletion and related records', () => {
  const h = setup(); h.controller.start({ type: 'customer', id: 'A' }); h.timeout();
  assert.equal(h.saves, 1); assert.equal(h.current.jobs.length, 1); assert.equal(h.current.payments.length, 1); assert.equal(h.current.reminders.length, 0); assert.equal(h.current.notes.length, 0); assert.equal(h.current.customerPhones.A, undefined);
});
test('another edit flushes the pending deletion first', () => {
  const h = setup(); h.controller.start({ type: 'entry', id: 'a' }); h.controller.flush();
  assert.equal(h.saves, 1); assert.equal(h.current.jobs[0].id, 'b'); assert.equal(h.pending, null);
});
test('a second delete flushes the first and remains undoable', () => {
  const h = setup(); h.controller.start({ type: 'entry', id: 'a' }); h.controller.start({ type: 'entry', id: 'b' });
  assert.equal(h.saves, 1); assert.equal(h.current.jobs[0].id, 'b'); h.controller.undo(); assert.equal(h.saves, 1); assert.equal(h.visible.jobs[0].id, 'b');
});
