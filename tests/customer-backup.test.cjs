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
  assert.deepEqual(Array.from(prepared.items, item => item.customer_key), ['mina']);
  for (const invalid of [{ ...slice, jobs: [job('', 'Sara')] }, { ...slice, payments: [payment('p1', 'missing', 'Sara')] }, { ...slice, jobs: [job('j1', 'Sara', -1)] }, { ...slice, jobs: [{ ...job('j1', 'Sara'), date: '2026-02-30' }] }]) assert.equal(backup.validateCustomerSlice(invalid), false);
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
  assert.doesNotMatch(workspace, /scheduleDailyBackupAfterCloudSave|saveWorkspaceBackup\(snapshot, "daily"/);
  assert.doesNotMatch(page, /Preferred backup history|Download Backup|Restore from File/);
  assert.match(sql, /s\.status='active' and s\.period_end>now\(\)/);
});
