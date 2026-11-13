const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const ts = require('typescript');
const { webcrypto } = require('node:crypto');
function load(file, mocks = {}) {
  const module = { exports: {} };
  const source = ts.transpileModule(fs.readFileSync(file, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  vm.runInNewContext(source, { module, exports: module.exports, require: name => mocks[name] || require(name), crypto: webcrypto, TextEncoder, Intl, Date, Set, Map });
  return module.exports;
}
const names = load('lib/customer-name.ts');
const backup = load('lib/customer-backup.ts', { './customer-name': names });
const job = (id, customer, total = 100) => ({ id, customer, work: 'Cake', total, paid: 20, date: '2026-11-10', time: '', status: 'Waiting', source: '' });
const payment = (id, jobId, customer) => ({ id, jobId, customer, amount: 20, date: '2026-11-10', createdAt: '2026-11-10T10:00:00Z' });
const snapshot = { owner: 'Owner', business: 'Shop', jobs: [job('j1', 'Sara'), job('j2', 'Mina', 200)], payments: [payment('p1', 'j1', 'SARA'), payment('p2', 'j2', 'Mina')], notes: [{ id: 'n1', customer: 'sara', text: 'Call', createdAt: '2026-11-10T10:00:00Z' }], reminders: [], customerPhones: { SaRa: '123', Mina: '456' } };

test('customer slices match case-insensitively and validation skips corrupt records', async () => {
  const slice = backup.sliceCustomer(snapshot, ' SARA ');
  assert.equal(slice.customer_key, 'sara');
  assert.deepEqual(Array.from(slice.jobs, j => j.id), ['j1']);
  assert.deepEqual(Array.from(slice.payments, p => p.id), ['p1']);
  assert.equal(slice.phone, '123');
  assert.equal(backup.validateCustomerSlice(slice), true);
  const bad = { ...snapshot, payments: [{ ...snapshot.payments[0], amount: Infinity }, snapshot.payments[1]] };
  const prepared = await backup.prepareCustomerBackups(bad, ['sara', 'mina']);
  assert.deepEqual(Array.from(prepared.skipped), ['Sara']);
  assert.deepEqual(Array.from(prepared.notFound), []);
  assert.deepEqual(Array.from(prepared.items, item => item.customer_key), ['mina']);
  for (const invalid of [{ ...slice, jobs: [job('', 'Sara')] }, { ...slice, payments: [payment('p1', 'missing', 'Sara')] }, { ...slice, jobs: [job('j1', 'Sara', -1)] }, { ...slice, jobs: [{ ...job('j1', 'Sara'), date: '2026-02-30' }] }]) assert.equal(backup.validateCustomerSlice(invalid), false);
  const withoutJob = { ...slice, payments: [{ ...slice.payments[0], jobId: undefined }] };
  assert.equal(backup.validateCustomerSlice(withoutJob), true);
  assert.equal(backup.restoreCustomer(snapshot, withoutJob).snapshot.payments.find(p => p.id === 'p1').jobId, undefined);
  const missing = await backup.prepareCustomerBackups(snapshot, ['former customer']);
  assert.deepEqual(Array.from(missing.skipped), []);
  assert.deepEqual(Array.from(missing.notFound), ['former customer']);
});

test('equal slices hash identically; changed amounts change the hash; SQL skips latest hash and prunes to three', async () => {
  const first = backup.sliceCustomer(snapshot, 'Sara');
  const same = backup.sliceCustomer(snapshot, 'sara');
  assert.equal(await backup.hashCustomerSlice(first), await backup.hashCustomerSlice(same));
  assert.equal(await backup.hashCustomerSlice(first), await backup.hashCustomerSlice({ ...first, jobs: first.jobs.map(j => ({ paid: j.paid, total: j.total, ...j })) }));
  assert.notEqual(await backup.hashCustomerSlice(first), await backup.hashCustomerSlice({ ...first, jobs: [{ ...first.jobs[0], total: 101 }] }));
  const sql = fs.readFileSync('supabase/migrations/20261113000000_customer_backups.sql', 'utf8');
  assert.match(sql, /order by b\.created_at desc,b\.id desc limit 1\)=h/);
  assert.match(sql, /order by created_at desc,id desc limit 3/);
  assert.match(sql, /customer_backups_select_own[\s\S]*owner_id = auth\.uid\(\)/);
});

test('daily, weekly and monthly slots catch up in the chosen timezone', () => {
  const base = { frequency: 'daily', time_of_day: '09:30:00', tz: 'Asia/Kolkata', anchor_day: null, customers: ['sara'], last_run_at: null };
  const now = new Date('2026-11-13T06:00:00Z');
  assert.equal(backup.scheduledSlot(base, now).toISOString(), '2026-11-13T04:00:00.000Z');
  assert.equal(backup.backupDue(base, now).toISOString(), '2026-11-13T04:00:00.000Z');
  assert.equal(backup.backupDue({ ...base, last_run_at: '2026-11-13T04:01:00Z' }, now), null);
  assert.equal(backup.scheduledSlot({ ...base, frequency: 'weekly', anchor_day: 5 }, now).toISOString(), '2026-11-13T04:00:00.000Z');
  assert.equal(backup.scheduledSlot({ ...base, frequency: 'monthly', anchor_day: 12 }, now).toISOString(), '2026-11-12T04:00:00.000Z');
  assert.equal(backup.scheduledSlot({ ...base, frequency: 'daily', tz: 'America/New_York' }, new Date('2026-11-13T16:00:00Z')).toISOString(), '2026-11-13T14:30:00.000Z');
  const spring = { ...base, time_of_day: '02:30:00', tz: 'America/New_York' };
  assert.equal(backup.scheduledSlot(spring, new Date('2026-03-08T07:00:00Z')).toISOString(), '2026-03-07T07:30:00.000Z');
  assert.equal(backup.scheduledSlot(spring, new Date('2026-03-08T08:00:00Z')).toISOString(), '2026-03-08T07:30:00.000Z');
  assert.equal(backup.anchorDayForSave('weekly', 'Asia/Kolkata', now), 5);
  assert.equal(backup.anchorDayForSave('monthly', 'Asia/Kolkata', new Date('2026-11-30T10:00:00Z')), 28);
  assert.equal(backup.backupDue({ ...base, frequency: 'off' }, now), null);
});

test('restore replaces only the selected customer and remaps deleted historical IDs', () => {
  const old = backup.sliceCustomer(snapshot, 'Sara');
  const current = { ...snapshot, jobs: [snapshot.jobs[1]], payments: [snapshot.payments[1]], notes: [], customerPhones: { Mina: '456' } };
  let sequence = 0;
  const result = backup.restoreCustomer(current, old, new Set(['j1']), new Set(['p1']), () => `new-${++sequence}`);
  assert.equal(result.copiedJobs, 1);
  assert.deepEqual(Array.from(result.snapshot.jobs, j => j.id), ['j2', 'new-1']);
  assert.equal(result.snapshot.payments.find(p => p.customer === 'SARA').jobId, 'new-1');
  assert.equal(result.snapshot.payments.find(p => p.customer === 'SARA').id, 'new-2');
  assert.deepEqual(result.snapshot.jobs[0], snapshot.jobs[1]);
  assert.deepEqual(result.snapshot.payments[0], snapshot.payments[1]);
  assert.equal(result.snapshot.customerPhones.Mina, '456');
  assert.equal(result.snapshot.customerPhones.SaRa, undefined);
  assert.equal(result.snapshot.customerPhones.Sara, '123');
  const changed = { ...snapshot, jobs: [job('j1', 'SARA', 500), snapshot.jobs[1]], customerPhones: { SARA: '999', Mina: '456' } };
  const replacement = backup.restoreCustomer(changed, old);
  assert.equal(replacement.snapshot.jobs.find(j => j.id === 'j1').total, 100);
  assert.deepEqual(replacement.snapshot.jobs.find(j => j.id === 'j2'), snapshot.jobs[1]);
  assert.equal(replacement.snapshot.customerPhones.SARA, undefined);
  assert.equal(replacement.snapshot.customerPhones.Mina, '456');
  assert.equal(backup.entriesAddedAfterBackup(changed, old), 0);
  assert.equal(backup.entriesAddedAfterBackup({ ...changed, jobs: [...changed.jobs, job('j3', 'sara')] }, old), 1);
});

test('hardening RPC persists only selection, rejects unselected keys, and caps payloads', () => {
  const sql = fs.readFileSync('supabase/migrations/20261113000001_customer_backups_hardening.sql', 'utf8');
  const selectRpc = sql.slice(sql.indexOf('create or replace function public.set_backup_customers'), sql.indexOf('revoke all on function public.set_backup_customers'));
  const saveRpc = sql.slice(sql.indexOf('create or replace function public.save_customer_backups'));
  assert.match(selectRpc, /customers text\[\]/);
  assert.match(selectRpc, /s\.status='active' and s\.period_end>now\(\)/);
  assert.match(selectRpc, /array_length\(wanted,1\),0\)>500/);
  assert.match(selectRpc, /key is null or key='' or key<>btrim\(key\)/);
  assert.match(selectRpc, /on conflict\(owner_id\) do update set customers=excluded\.customers,updated_at=now\(\)/);
  assert.doesNotMatch(selectRpc, /on conflict[\s\S]*frequency=|on conflict[\s\S]*time_of_day=|on conflict[\s\S]*anchor_day=/);
  assert.match(saveRpc, /k=any\(s\.customers\)/);
  assert.match(saveRpc, /k=any\(s\.customers\) for share/);
  assert.match(saveRpc, /rejected := rejected\+1;\s*continue;/);
  assert.match(saveRpc, /char_length\(k\)>200/);
  assert.match(saveRpc, /char_length\(item->>'customer_name'\)>200/);
  assert.match(saveRpc, /octet_length\(\(item->'payload'\)::text\)>2000000/);
  assert.match(saveRpc, /jsonb_typeof\(item->'payload'\) is distinct from 'object'/);
  assert.match(saveRpc, /'rejected',rejected/);
  assert.match(sql, /create or replace function public\.delete_customer_backups[\s\S]*where owner_id=uid for update;[\s\S]*delete from public\.customer_backups/);
  for (const policy of ['workspace_backup_settings_select_own', 'customer_backups_select_own']) assert.match(sql, new RegExp(`drop policy if exists ${policy}[\\s\\S]*create policy ${policy}[\\s\\S]*owner_id = \\(select auth\\.uid\\(\\)\\)`));
});

test('selection writes happen on tick, select all, and before Back up without saving schedule edits', () => {
  const page = fs.readFileSync('app/cloud-settings.tsx', 'utf8');
  const cloud = fs.readFileSync('lib/cloud.ts', 'utf8');
  assert.match(cloud, /rpc\/set_backup_customers", \{ customers \}/);
  assert.match(page, /async function backUpNow\(\)[\s\S]*await setBackupCustomers\(draft\.customers, ownerId\); setStatus\(await runSelectedCustomerBackup/);
  assert.match(page, /async function selectAll\(\)[\s\S]*await setBackupCustomers\(customers, ownerId\); setDraft/);
  assert.match(page, /async function toggleCustomer\(key: string\)[\s\S]*else if \(ownerId && canBackup\)[\s\S]*await setBackupCustomers\(customers, ownerId\); setDraft/);
  assert.match(page, /Restore \$\{backup\.customer_name\} from \$\{dateLabel\(backup\.created_at\)\}\? \$\{added\} entries added after this backup will be removed from \$\{backup\.customer_name\}\. A safety copy is saved first\./);
});

test('missing selected customer keeps prior backup and reports it separately from invalid data', async () => {
  const runner = load('lib/workspace-daily-backup-lifecycle.ts', {
    './customer-backup': backup,
    './cloud': { saveCustomerBackups: async () => { throw Error('No save expected'); }, setBackupSettings: async () => {}, loadCustomerBackups: async () => [{ customer_key: 'former customer', customer_name: 'Former Customer' }] },
    './workspace-daily-backup-coordinator': { WorkspaceDailyBackupCoordinator: class {} },
  });
  const settings = { frequency: 'manual', time_of_day: null, tz: 'UTC', anchor_day: null, customers: ['former customer'], last_run_at: null };
  assert.equal(await runner.runSelectedCustomerBackup(snapshot, settings, 'owner-1'), 'Backed up 0, unchanged 0, skipped 0. Former Customer not found, old backup kept');
  const rejected = load('lib/workspace-daily-backup-lifecycle.ts', {
    './customer-backup': backup,
    './cloud': { saveCustomerBackups: async () => ({ backed_up: 0, unchanged: 0, rejected: 1 }), setBackupSettings: async () => {}, loadCustomerBackups: async () => [] },
    './workspace-daily-backup-coordinator': { WorkspaceDailyBackupCoordinator: class {} },
  });
  assert.equal(await rejected.runSelectedCustomerBackup(snapshot, { ...settings, customers: ['sara'] }, 'owner-1'), 'Backed up 0, unchanged 0, skipped 0, rejected 1');
});

test('backup screen and scheduler use selected customers without legacy daily writes', () => {
  const page = fs.readFileSync('app/cloud-settings.tsx', 'utf8');
  const workspace = fs.readFileSync('app/workspace.tsx', 'utf8');
  const sql = fs.readFileSync('supabase/migrations/20261113000000_customer_backups.sql', 'utf8');
  assert.match(page, /Keep the app open at backup time\. If closed, it runs when you next open it\./);
  assert.match(page, /draft\.customers\.length === 0 \|\| scheduleNeedsTime && !draft\.time_of_day/);
  assert.match(page, /saveWorkspaceBackup\(snapshot, "pre_restore", ownerId\)/);
  assert.match(workspace, /visibilitychange/);
  assert.match(workspace, /60_000/);
  assert.match(workspace, /!backupDue\(settings\)/);
  assert.match(workspace, /currentSnapshotForBackupRef\.current\(\)/);
  assert.match(workspace, /\}, \[ready, loggedIn, hasActiveSubscription, isOnline, accountId\]\);/);
  assert.doesNotMatch(workspace, /scheduleDailyBackupAfterCloudSave|saveWorkspaceBackup\(snapshot, "daily"/);
  assert.doesNotMatch(page, /Preferred backup history|Download Backup|Restore from File/);
  assert.match(sql, /s\.status='active' and s\.period_end>now\(\)/);
});
