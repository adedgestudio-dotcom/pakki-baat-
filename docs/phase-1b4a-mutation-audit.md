# Phase 1B.4A persisted workspace setter audit

Baseline: 57 direct `setJobs`, `setPayments`, `setReminders`, `setNotes`, `setCustomerPhones`, `setOwner`, or `setBusiness` calls in `app/workspace.tsx`. `tests/workspace-persisted-setter-audit.test.cjs` is the explicit allowlist; new direct setters fail the audit, while migrations remove entries.

| Class | Locations / examples | Policy |
| --- | --- | --- |
| Hydration/reset | 694-700, 1752-1756, 2697-2703 | Approved application internals; never journal. |
| Profile/phone/status/reminder user mutations | 458-459, 2477-2508, 2582, 2849, 2911 | Migrate through the boundary. |
| Hisaab/payment/chat user mutations | 1874, 1917, 1942-44, 1986-89, 2057-60, 2108-10, 2564-65 | Require coordinated job/payment planner and ledger policy. |
| Delete/import/undo/sample/inline mutations | 1544, 2451-57, 2606-28, 2669, 2809, 4404, 4552 | Require special-operation policy and journal-aware backup workflow. |

Special policies: immediate-cloud reminder save, undo, and import/restore are **blocked** until a journal-aware cloud/backup state machine exists. Pre-operation backups are **deferred** until the corresponding journal snapshot has confirmed cloud acknowledgment. No special policy authorizes a cloud write in Phase 1B.4A.
