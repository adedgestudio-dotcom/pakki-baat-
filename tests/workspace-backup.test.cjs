const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const ts = require('typescript');
const { webcrypto } = require('node:crypto');

function load(file, mocks = {}) {
  const module = { exports: {} };
  const source = ts.transpileModule(fs.readFileSync(file, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  vm.runInNewContext(source, { module, exports: module.exports, require: name => mocks[name] || require(name), crypto: webcrypto, TextEncoder, Date, Intl, Set, Map });
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
      setBackupSettings: async () => {},
    },
  });
  const settings = { frequency: 'manual', time_of_day: null, tz: 'Asia/Kolkata', anchor_day: null, customers: [], last_run_at: null };
  const first = await runner.runWorkspaceBackup(saved, settings, 'owner', 'manual');
  const second = await runner.runWorkspaceBackup(saved, settings, 'owner', 'manual');
  assert.equal(writes, 2);
  assert.equal(first, `Backup done ✓ ${backup.workspaceBackupFileName(createdAt[0], settings.tz)}`);
  assert.equal(second, `Backup done ✓ ${backup.workspaceBackupFileName(createdAt[1], settings.tz)}`);
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
