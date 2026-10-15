/* eslint-disable @typescript-eslint/no-require-imports */
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const ts = require("typescript");
const vm = require("node:vm");
const crypto = require("node:crypto");

const root = path.join(__dirname, "..");
const compile = file => ts.transpileModule(fs.readFileSync(path.join(root, "lib", file), "utf8"), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText;
const run = (target, file, require = () => ({}), extra = {}) => vm.runInNewContext(compile(file), {
  module: target, exports: target.exports, require, JSON, Date, Set, TextEncoder, crypto: crypto.webcrypto, localStorage: undefined, ...extra,
});

function api() {
  const data = { exports: {} }, journal = { exports: {} }, transaction = { exports: {} }, plan = { exports: {} }, reconciliation = { exports: {} }, special = { exports: {} }, backup = { exports: {} };
  run(data, "data.ts");
  run(journal, "workspace-journal.ts", name => name === "./data" ? data.exports : {});
  run(transaction, "workspace-transaction.ts", name => name === "./data" ? data.exports : name === "./workspace-journal" ? journal.exports : {});
  run(plan, "workspace-mutation-plan.ts", name => name === "./workspace-transaction" ? transaction.exports : {});
  run(reconciliation, "workspace-reconciliation.ts", name => name === "./data" ? data.exports : name === "./workspace-journal" ? journal.exports : {});
  run(special, "workspace-special-workflow.ts");
  run(backup, "verified-workspace-backup.ts", name => name === "./data" ? data.exports : name === "./workspace-special-workflow" ? special.exports : {});
  return { data: data.exports, journal: journal.exports, plan: plan.exports, reconciliation: reconciliation.exports, backup: backup.exports };
}

const owner = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const otherOwner = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const backupId = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const operationId = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";
const clone = value => JSON.parse(JSON.stringify(value));

function syntheticSnapshot() {
  return {
    owner: "Synthetic Workshop", business: "Synthetic Repair Co.",
    customerPhones: { "Customer Aurora": "919000000001", "Customer Birch": "919000000002" },
    jobs: [
      { id: "job-aurora", customer: "Customer Aurora", work: "Synthetic repair", total: 1200, paid: 300, date: "2026-10-15", time: "09:00", status: "Confirmed", source: "synthetic" },
      { id: "job-birch", customer: "Customer Birch", work: "Synthetic service", total: 800, paid: 800, date: "2026-10-16", time: "10:30", status: "Completed", source: "synthetic" },
    ],
    payments: [
      { id: "payment-aurora-partial", customer: "Customer Aurora", jobId: "job-aurora", amount: 300, date: "2026-10-15", note: "Synthetic partial", createdAt: "2026-10-15T09:30:00.000Z" },
      { id: "payment-birch-first", customer: "Customer Birch", jobId: "job-birch", amount: 500, date: "2026-10-16", note: "Synthetic first", createdAt: "2026-10-16T10:45:00.000Z" },
      { id: "payment-birch-final", customer: "Customer Birch", jobId: "job-birch", amount: 300, date: "2026-10-16", note: "Synthetic final", createdAt: "2026-10-16T11:00:00.000Z" },
    ],
    reminders: [
      { id: "reminder-aurora", text: "Synthetic follow-up", date: "2026-10-20", time: "12:00", customer: "Customer Aurora", jobId: "job-aurora", repeat: "weekly", done: false, createdAt: "2026-10-15T09:31:00.000Z" },
      { id: "reminder-birch", text: "Synthetic archive", date: "2026-10-17", time: "", customer: "Customer Birch", jobId: "job-birch", repeat: "none", done: true, createdAt: "2026-10-16T11:01:00.000Z" },
    ],
    notes: [
      { id: "note-aurora", customer: "Customer Aurora", text: "Synthetic contact preference", createdAt: "2026-10-15T09:32:00.000Z" },
      { id: "note-birch", customer: "Customer Birch", text: "Synthetic completion note", createdAt: "2026-10-16T11:02:00.000Z" },
    ],
  };
}

function totals(snapshot) {
  const sales = snapshot.jobs.reduce((sum, job) => sum + job.total, 0);
  const received = snapshot.payments.reduce((sum, payment) => sum + payment.amount, 0);
  return { sales, received, outstanding: sales - received };
}

function storage() {
  const values = new Map();
  return { values, getItem: key => values.get(key) ?? null, setItem: (key, value) => values.set(key, value), removeItem: key => values.delete(key) };
}

function pending(snapshot, extra = {}) {
  return { version: 1, ownerId: owner, baseRevision: 7, syncStrategy: "revisioned", operationId, createdAt: "2026-10-15T12:00:00.000Z", snapshot, ...extra };
}

function recoveryInput(snapshot, extra = {}) {
  return { ownerId: owner, cloudAvailable: true, cloudOwnerId: owner, cloudSnapshot: snapshot, cloudRevision: 7, ledgerEnabled: true, journal: null, ledgerDirty: null, localSnapshot: snapshot, ...extra };
}

test("synthetic customer names, phone numbers, and notes survive journal-backed recovery", async () => {
  const a = api(), value = syntheticSnapshot(), store = storage(), entry = pending(value);
  a.journal.commitPendingWorkspaceSnapshot(entry, store);
  const recovered = a.journal.readWorkspaceRecovery(owner, store);
  assert.equal(recovered.source, "pending");
  assert.deepEqual(recovered.snapshot.customerPhones, value.customerPhones);
  assert.deepEqual(recovered.snapshot.notes, value.notes);
  assert.equal(await a.backup.canonicalWorkspaceSnapshotDigest(recovered.snapshot), await a.backup.canonicalWorkspaceSnapshotDigest(value));
});

test("synthetic jobs and partial payments retain IDs, values, and customer relationships", () => {
  const a = api(), value = syntheticSnapshot(), result = a.reconciliation.reconcileWorkspaceRecovery(recoveryInput(value, { journal: pending(value), cloudSnapshot: clone(value) }));
  assert.equal(result.state, "journal-acknowledged");
  assert.deepEqual(result.displaySnapshot.jobs.map(job => [job.id, job.customer, job.total, job.paid]), [["job-aurora", "Customer Aurora", 1200, 300], ["job-birch", "Customer Birch", 800, 800]]);
  assert.deepEqual(result.displaySnapshot.payments.map(payment => [payment.id, payment.customer, payment.jobId, payment.amount]), [["payment-aurora-partial", "Customer Aurora", "job-aurora", 300], ["payment-birch-first", "Customer Birch", "job-birch", 500], ["payment-birch-final", "Customer Birch", "job-birch", 300]]);
});

test("sales, received, and outstanding balances match before and after recovery", () => {
  const a = api(), value = syntheticSnapshot(), result = a.reconciliation.reconcileWorkspaceRecovery(recoveryInput(value, { journal: pending(value), cloudSnapshot: clone(value) }));
  assert.deepEqual(totals(value), { sales: 2000, received: 1100, outstanding: 900 });
  assert.deepEqual(totals(result.displaySnapshot), totals(value));
});

test("synthetic reminders retain dates, statuses, and customer/job associations", () => {
  const a = api(), value = syntheticSnapshot(), result = a.reconciliation.reconcileWorkspaceRecovery(recoveryInput(value, { journal: pending(value), cloudSnapshot: clone(value) }));
  assert.deepEqual(result.displaySnapshot.reminders.map(reminder => [reminder.id, reminder.date, reminder.done, reminder.customer, reminder.jobId]), [["reminder-aurora", "2026-10-20", false, "Customer Aurora", "job-aurora"], ["reminder-birch", "2026-10-17", true, "Customer Birch", "job-birch"]]);
});

test("duplicate job identities and duplicate payment mutations are rejected", () => {
  const a = api(), value = syntheticSnapshot();
  const duplicateJob = clone(value);
  duplicateJob.jobs.push(clone(duplicateJob.jobs[0]));
  assert.equal(a.data.isSnapshot(duplicateJob), false);
  const plan = a.plan.planWorkspaceMutation(value, { kind: "append-payment", jobId: "job-aurora", paid: 600, payment: { ...value.payments[0], amount: 600 } });
  assert.equal(plan.accepted, false);
  assert.match(plan.reason, /duplicate payment/i);
});

test("altered or structurally corrupt synthetic backup snapshots are rejected", async () => {
  const a = api(), value = syntheticSnapshot(), digest = await a.backup.canonicalWorkspaceSnapshotDigest(value);
  const confirmation = { backup_id: backupId, owner_id: owner, backup_kind: "pre_restore", payload_sha256: digest, created_at: "2026-10-15T12:01:00.000Z" };
  const altered = clone(value);
  altered.customerPhones["Customer Aurora"] = "919000000099";
  await assert.rejects(a.backup.verifyWorkspaceBackupConfirmation(altered, owner, "pre_restore", confirmation), /does not match/i);
  const corrupt = clone(value);
  corrupt.jobs[0].paid = corrupt.jobs[0].total + 1;
  await assert.rejects(a.backup.canonicalWorkspaceSnapshotDigest(corrupt), /valid complete snapshot/i);
});

test("account mismatch fails closed without replacing the existing local snapshot", () => {
  const a = api(), local = syntheticSnapshot(), foreign = { ...pending(clone(local)), ownerId: otherOwner };
  const result = a.reconciliation.reconcileWorkspaceRecovery(recoveryInput(local, { journal: foreign }));
  assert.equal(result.state, "recovery-conflict");
  assert.equal(result.preserve.journal, true);
  assert.deepEqual(result.displaySnapshot, local);
});

test("failed recovery preserves the last valid snapshot and pending journal", () => {
  const a = api(), local = syntheticSnapshot(), store = storage(), entry = pending(clone(local));
  store.setItem(a.journal.localWorkspaceStorageKey(owner), JSON.stringify(local));
  store.setItem(a.journal.pendingWorkspaceJournalKey(owner), "{not-json");
  assert.equal(a.journal.readWorkspaceRecovery(owner, store).source, "invalid-pending");
  assert.equal(store.getItem(a.journal.localWorkspaceStorageKey(owner)), JSON.stringify(local));
  assert.equal(store.getItem(a.journal.pendingWorkspaceJournalKey(owner)), "{not-json");
  const advancedCloud = { ...clone(local), business: "Synthetic Repair Co. Cloud" };
  const conflict = a.reconciliation.reconcileWorkspaceRecovery(recoveryInput(local, { journal: entry, cloudRevision: 8, cloudSnapshot: advancedCloud }));
  assert.equal(conflict.state, "recovery-conflict");
  assert.equal(conflict.preserve.journal, true);
  assert.equal(conflict.preserve.localSnapshot, true);
});
