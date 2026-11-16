const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const ts = require('typescript');
const { webcrypto } = require('node:crypto');

function load(file, mocks = {}, globals = {}) {
  const module = { exports: {} };
  const source = ts.transpileModule(fs.readFileSync(file, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  vm.runInNewContext(source, { module, exports: module.exports, require: name => mocks[name] || require(name), crypto: webcrypto, TextEncoder, Date, Intl, Set, Map, ...globals });
  return module.exports;
}

const data = load('lib/data.ts', { './money': { formatMoneyRupees: () => '' } });
const backup = load('lib/customer-backup.ts', { './data': data });
const job = (id, total = 100) => ({ id, customer: 'Asha', work: 'Cake', total, paid: 0, date: '2026-11-14', time: '', status: 'Waiting', source: '' });
const saved = { owner: 'Owner', business: 'Shop', jobs: [job('j1'), job('j2'), job('j3')], payments: [], notes: [], reminders: [], customerPhones: { Asha: '123' } };
const current = { ...saved, jobs: [...saved.jobs, job('j4')] };

test('whole-snapshot restore removes later entries and preserves the saved workspace exactly', () => {
  const restored = backup.restoreWorkspaceSnapshot(saved, current);
  assert.equal(restored, saved);
  assert.deepEqual(Array.from(restored.jobs, row => row.id), ['j1', 'j2', 'j3']);
  assert.deepEqual(restored.customerPhones, { Asha: '123' });
  assert.deepEqual(Array.from(current.jobs, row => row.id), ['j1', 'j2', 'j3', 'j4']);
});

test('restore returns the backup unchanged when its IDs are missing now', () => {
  const now = { ...current, jobs: current.jobs.filter(row => row.id !== 'j2') };
  const before = JSON.stringify(now);
  assert.equal(backup.restoreWorkspaceSnapshot(saved, now), saved);
  assert.equal(JSON.stringify(now), before);
});

test('damaged backup still throws', () => {
  assert.throws(() => backup.restoreWorkspaceSnapshot({ ...saved, payments: [{ id: 'p1', jobId: 'missing' }] }, current), /damaged or invalid|invalid payment links/);
});

test('lastRegularBackup ignores newer safety copies and returns the newest regular backup', () => {
  const backups = [
    { id: 'restore', backup_kind: 'pre_restore', created_at: '2026-11-15T11:00:00Z' },
    { id: 'delete', backup_kind: 'pre_delete', created_at: '2026-11-15T10:00:00Z' },
    { id: 'manual', backup_kind: 'manual', created_at: '2026-11-15T09:00:00Z' },
    { id: 'daily', backup_kind: 'daily', created_at: '2026-11-15T08:00:00Z' },
  ];
  assert.equal(backup.lastRegularBackup(backups).id, 'manual');
});

test('lastRegularBackup returns null when only safety copies exist', () => {
  assert.equal(backup.lastRegularBackup([
    { backup_kind: 'pre_restore', created_at: '2026-11-15T11:00:00Z' },
    { backup_kind: 'pre_delete', created_at: '2026-11-15T10:00:00Z' },
  ]), null);
});

test('undo uses only the newest recent pre-restore copy unless a newer regular backup exists', () => {
  const now = Date.parse('2026-11-15T12:00:00Z');
  const copy = { id: 'copy', backup_kind: 'pre_restore', created_at: '2026-11-15T11:00:00Z' };
  const deletion = { id: 'delete', backup_kind: 'pre_delete', created_at: '2026-11-15T11:30:00Z' };
  assert.equal(backup.undoRestoreBackup([copy, deletion], now), copy);
  assert.equal(backup.undoRestoreBackup([copy, { backup_kind: 'manual', created_at: '2026-11-15T11:30:00Z' }], now), null);
  assert.equal(backup.undoRestoreBackup([copy], now + 7 * 86400000), null);
  assert.equal(backup.undoRestoreBackup([deletion], now), null);
});

test('restore menu excludes safety copies and undo uses the existing restore flow', () => {
  const settings = fs.readFileSync('app/cloud-settings.tsx', 'utf8');
  assert.match(settings, /const menuBackups = regularBackups/);
  assert.doesNotMatch(settings, /"Safety copies"/);
  assert.match(settings, /restoreBackup\(undoBackup\)/);
  assert.match(settings, /loadBackupPayload\(backup\.id, ownerId\)[\s\S]*?saveWorkspaceBackup\(snapshot, "pre_restore", ownerId\)[\s\S]*?restoreCloud\(restored, ownerId\)/);
});

test('backup kind labels cover regular, safety, and unknown kinds', () => {
  assert.equal(backup.backupKindLabel('daily'), 'Automatic');
  assert.equal(backup.backupKindLabel('scheduled'), 'Automatic');
  assert.equal(backup.backupKindLabel('manual'), 'Manual');
  assert.equal(backup.backupKindLabel('pre_restore'), 'Before restore');
  assert.equal(backup.backupKindLabel('pre_delete'), 'Before deletion');
  assert.equal(backup.backupKindLabel('legacy_copy'), 'Older safety copy');
});

test('backup groups are newest first and unknown kinds stay with safety copies', () => {
  const grouped = backup.groupWorkspaceBackups([
    { id: 'manual-old', backup_kind: 'manual', created_at: '2026-11-15T08:00:00Z' },
    { id: 'delete-new', backup_kind: 'pre_delete', created_at: '2026-11-15T12:00:00Z' },
    { id: 'daily-new', backup_kind: 'daily', created_at: '2026-11-15T11:00:00Z' },
    { id: 'unknown-old', backup_kind: 'legacy_copy', created_at: '2026-11-15T09:00:00Z' },
    { id: 'restore-middle', backup_kind: 'pre_restore', created_at: '2026-11-15T10:00:00Z' },
  ]);
  assert.deepEqual(Array.from(grouped.regular, row => row.id), ['daily-new', 'manual-old']);
  assert.deepEqual(Array.from(grouped.safety, row => row.id), ['delete-new', 'restore-middle', 'unknown-old']);
});

test('backup list falls back to the payload loader when the metadata RPC fails', async () => {
  const requests = [];
  const session = { user: { id: 'owner' }, access_token: 'token' };
  const client = { auth: { getSession: async () => ({ data: { session }, error: null }) } };
  const oldBackup = { id: 'old', payload: saved, backup_kind: 'manual', backup_day: '2026-11-15', created_at: '2026-11-15T09:00:00Z' };
  const cloud = load('lib/cloud.ts', {
    '@supabase/supabase-js': { createClient: () => client },
    './data': data,
  }, {
    process: { env: { NEXT_PUBLIC_SUPABASE_URL: 'https://example.test', NEXT_PUBLIC_SUPABASE_ANON_KEY: 'key' } },
    fetch: async (url, options) => {
      requests.push({ url, options });
      if (String(url).includes('/rpc/list_workspace_backups')) return { ok: false, status: 404, text: async () => JSON.stringify({ message: 'missing RPC' }) };
      return { ok: true, status: 200, text: async () => JSON.stringify([oldBackup]) };
    },
  });
  const rows = await cloud.loadBackupList('owner');
  assert.equal(requests.length, 2);
  assert.match(requests[0].url, /\/rpc\/list_workspace_backups$/);
  assert.deepEqual(JSON.parse(requests[0].options.body), { p_limit: 200 });
  assert.match(requests[1].url, /select=id,payload,backup_kind,backup_day,created_at/);
  assert.deepEqual(JSON.parse(JSON.stringify(rows)), [{ id: 'old', backup_kind: 'manual', created_at: '2026-11-15T09:00:00Z', entry_count: 3, customer_count: 1 }]);
});

test('delete safety copies use pre_delete while restore safety copies stay pre_restore', () => {
  const workspace = fs.readFileSync('app/workspace.tsx', 'utf8');
  const settings = fs.readFileSync('app/cloud-settings.tsx', 'utf8');
  assert.match(workspace, /saveWorkspaceBackup\(current, "pre_delete"\)/);
  assert.match(workspace, /async function deleteReminder[\s\S]{0,500}savePreDeleteSafetyCopy\(\)/);
  assert.match(workspace, /async function confirmDeleteCustomer[\s\S]{0,500}savePreDeleteSafetyCopy\(\)/);
  assert.match(workspace, /async function confirmDeleteEntry[\s\S]{0,500}savePreDeleteSafetyCopy\(\)/);
  assert.match(workspace, /saveWorkspaceBackup\([\s\S]{0,100}currentSnapshot\(\)[\s\S]{0,100}"pre_restore"/);
  assert.match(settings, /saveWorkspaceBackup\(snapshot, "pre_restore", ownerId\)/);
});

test('last backup UI and warning route use regular backups only', () => {
  const settings = fs.readFileSync('app/cloud-settings.tsx', 'utf8');
  const route = fs.readFileSync('app/api/push/backup-warning/route.ts', 'utf8');
  assert.match(settings, /const last = lastRegularBackup\(backups\)/);
  assert.match(settings, /loadBackupList\(ownerId\)/);
  assert.equal((settings.match(/loadBackupPayload\(backup\.id, ownerId\)/g) || []).length, 2);
  assert.match(settings, /No regular backup yet\./);
  assert.match(route, /lastRegularBackup\(Array\.isArray\(rows\) \? rows : \[\]\)/);
  assert.match(route, /backup_kind=in\.\(daily,manual,scheduled\)/);
});

test('always creates a new backup, even when nothing changed, and returns its name', async () => {
  let writes = 0;
  const createdAt = ['2026-11-15T09:00:00Z', '2026-11-15T09:01:00Z'];
  const runner = load('lib/workspace-daily-backup-lifecycle.ts', {
    './customer-backup': backup,
    './data': data,
    './workspace-daily-backup-coordinator': { WorkspaceDailyBackupCoordinator: class {} },
    './cloud': {
      saveWorkspaceBackup: async (snapshot, kind, ownerId) => {
        assert.deepEqual(snapshot, saved);
        assert.equal(kind, 'manual');
        assert.equal(ownerId, 'owner');
        writes++;
        return { created: true, created_at: createdAt[writes - 1], id: `new-${writes}` };
      },
      setBackupSettings: async (_settings, _ownerId, lastRunAt) => assert.equal(lastRunAt, createdAt[writes - 1]),
      waitForCloudSaveQueue: async () => {},
    },
  });
  const settings = { frequency: 'manual', time_of_day: null, tz: 'Asia/Kolkata', anchor_day: null, customers: [], last_run_at: null };
  const first = await runner.runWorkspaceBackup(saved, settings, 'owner');
  const second = await runner.runWorkspaceBackup(saved, settings, 'owner');
  assert.equal(writes, 2);
  assert.equal(first, `Backup done ✓ ${backup.workspaceBackupFileName(createdAt[0], settings.tz)}`);
  assert.equal(second, `Backup done ✓ ${backup.workspaceBackupFileName(createdAt[1], settings.tz)}`);
});

test('Back up now waits for a pending save and ignores a second tap while running', async () => {
  let releaseSaveQueue;
  const saveQueue = new Promise(resolve => { releaseSaveQueue = resolve; });
  let writes = 0;
  const runner = load('lib/workspace-daily-backup-lifecycle.ts', {
    './customer-backup': backup,
    './data': data,
    './workspace-daily-backup-coordinator': { WorkspaceDailyBackupCoordinator: class {} },
    './cloud': {
      waitForCloudSaveQueue: async () => saveQueue,
      saveWorkspaceBackup: async () => { writes++; return { created: true, created_at: '2026-11-15T09:00:00Z', id: 'new' }; },
      setBackupSettings: async () => {},
    },
  });
  const settings = { frequency: 'manual', time_of_day: null, tz: 'Asia/Kolkata', anchor_day: null, customers: [], last_run_at: null };
  const manual = new runner.ManualWorkspaceBackupRunner();
  const first = manual.run(saved, settings, 'owner');
  await Promise.resolve();
  const second = await manual.run(saved, settings, 'owner');
  assert.equal(second, null);
  assert.equal(writes, 0);
  releaseSaveQueue();
  await first;
  assert.equal(writes, 1);
});

test('a failed manual backup produces no success result', async () => {
  let settingsWrites = 0;
  const runner = load('lib/workspace-daily-backup-lifecycle.ts', {
    './customer-backup': backup,
    './data': data,
    './workspace-daily-backup-coordinator': { WorkspaceDailyBackupCoordinator: class {} },
    './cloud': {
      waitForCloudSaveQueue: async () => {},
      saveWorkspaceBackup: async () => { throw new Error('server rejected backup'); },
      setBackupSettings: async () => { settingsWrites++; },
    },
  });
  const settings = { frequency: 'manual', time_of_day: null, tz: 'Asia/Kolkata', anchor_day: null, customers: [], last_run_at: null };
  await assert.rejects(new runner.ManualWorkspaceBackupRunner().run(saved, settings, 'owner'), /server rejected backup/);
  assert.equal(settingsWrites, 0);
});

test('scheduled backups have no client write path', () => {
  const workspace = fs.readFileSync('app/workspace.tsx', 'utf8');
  const settings = fs.readFileSync('app/cloud-settings.tsx', 'utf8');
  const lifecycle = fs.readFileSync('lib/workspace-daily-backup-lifecycle.ts', 'utf8');
  const cloud = fs.readFileSync('lib/cloud.ts', 'utf8');
  const clientBackupWriter = cloud.match(/export async function saveWorkspaceBackup\([^\n]+/)[0];
  assert.doesNotMatch(workspace, /backupDue\(|runWorkspaceBackup|scheduledBackupProgress|scheduledBackupError/);
  assert.doesNotMatch(lifecycle, /"manual"\s*\|\s*"scheduled"|saveWorkspaceBackup\([^\n]+"scheduled"/);
  assert.doesNotMatch(clientBackupWriter, /"scheduled"|"daily"/);
  assert.match(lifecycle, /await waitForCloudSaveQueue\(ownerId\)/);
  assert.match(settings, /Backups run automatically at this time, even when the app is closed\./);
  assert.match(settings, /Today at/);
});

test('retention SQL removes backups older than 30 days, caps at 60, and protects the newest and young safety copies', () => {
  const sql = fs.readFileSync('supabase/migrations/20261114000000_whole_workspace_backups.sql', 'utf8');
  assert.match(sql, /created_at < now\(\) - interval '30 days'/);
  assert.match(sql, /id <> newest_id/);
  assert.match(sql, /backup_kind = 'pre_restore' and created_at >= now\(\) - interval '30 days'/);
  assert.match(sql, /greatest\(60 - count\(\*\)::integer, 0\)/);
  assert.match(sql, /id not in \(select id from kept\)/);
  assert.match(sql, /md5\(latest\.payload::text\) = md5\(payload::text\) and latest\.payload = payload/);
});
