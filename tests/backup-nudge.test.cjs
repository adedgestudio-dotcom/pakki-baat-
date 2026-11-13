const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const ts = require('typescript');

const moduleState = { exports: {} };
const code = ts.transpileModule(fs.readFileSync('lib/backup-nudge.ts', 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText;
vm.runInNewContext(code, { module: moduleState, exports: moduleState.exports, Date, JSON, Number });
const { backupNudgeDue, readBackupNudge, rememberFirstUse, recordBackupNudge } = moduleState.exports;
const DAY = 86_400_000;
const NOW = 1_800_000_000_000;
const storage = () => {
  const data = new Map();
  return { getItem: key => data.get(key) ?? null, setItem: (key, value) => data.set(key, value) };
};
const due = (changes = {}) => backupNudgeDue({
  ready: true, signedIn: true, activeSubscription: true, ledgerMode: true,
  cloudConflict: false, online: true, listScreen: true, blockedByUi: false,
  frequency: 'off', lastRunAt: null, hasBackups: false, entryCount: 0,
  state: { firstSeen: NOW }, now: NOW, ...changes,
});

test('shows after three entries or 24 hours, whichever comes first', () => {
  assert.equal(due({ entryCount: 2 }), false);
  assert.equal(due({ entryCount: 3 }), true);
  assert.equal(due({ state: { firstSeen: NOW - DAY } }), true);
  assert.equal(due({ state: { firstSeen: NOW - DAY + 1 } }), false);
});

test('requires a never configured and never run backup', () => {
  assert.equal(due({ entryCount: 3, frequency: 'daily' }), false);
  assert.equal(due({ entryCount: 3, lastRunAt: '2026-11-12T10:00:00Z' }), false);
  assert.equal(due({ entryCount: 3, hasBackups: true }), false);
});

test('snoozes for two days and stops after three snoozes', () => {
  const store = storage();
  rememberFirstUse(store, 'a', NOW - DAY);
  recordBackupNudge(store, 'a', 'snooze', NOW);
  assert.equal(due({ state: readBackupNudge(store, 'a'), now: NOW + 2 * DAY - 1 }), false);
  assert.equal(due({ state: readBackupNudge(store, 'a'), now: NOW + 2 * DAY }), true);
  recordBackupNudge(store, 'a', 'snooze', NOW + 2 * DAY);
  recordBackupNudge(store, 'a', 'snooze', NOW + 4 * DAY);
  assert.equal(due({ state: readBackupNudge(store, 'a'), now: NOW + 10 * DAY }), false);
  const other = storage();
  rememberFirstUse(other, 'a', NOW - DAY);
  recordBackupNudge(other, 'a', 'setup', NOW);
  assert.equal(due({ state: readBackupNudge(other, 'a') }), false);
});

test('never shows inside entry chat, with a modal, offline, or without account eligibility', () => {
  for (const change of [
    { listScreen: false }, { blockedByUi: true }, { online: false },
    { ready: false }, { signedIn: false }, { activeSubscription: false },
    { ledgerMode: false }, { cloudConflict: true },
  ]) assert.equal(due({ entryCount: 3, ...change }), false);
  const workspace = fs.readFileSync('app/workspace.tsx', 'utf8');
  assert.match(workspace, /!selectedCustomer && !customerChatOpen/);
  assert.match(workspace, /document\.querySelector\('\[aria-modal="true"\], dialog\[open\]'\)/);
});

test('storage failure does not crash and only the entries rule applies', () => {
  const broken = { getItem() { throw new Error('disabled'); }, setItem() { throw new Error('disabled'); } };
  assert.equal(rememberFirstUse(broken, 'a', NOW), null);
  assert.doesNotThrow(() => recordBackupNudge(broken, 'a', 'snooze', NOW));
  assert.equal(due({ state: null, entryCount: 0, now: NOW + DAY }), false);
  assert.equal(due({ state: null, entryCount: 3 }), true);
});
