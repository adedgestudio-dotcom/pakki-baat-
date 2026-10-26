/**
 * Dormant coverage contract for the one-shot guarded-reducer cutover. These
 * are current app/workspace.tsx line numbers, intentionally audited by a test.
 * The live application does not import this module.
 */
export const PRIVILEGED_PERSISTED_SETTER_LINES = [782, 783, 784, 785, 786, 787, 788, 1864, 1865, 1866, 1867, 1868] as const;

export const GUARDED_MODE_SETTER_COVERAGE = {
  profile: [541, 542],
  reminderDelete: [1656],
  aiReminder: [1986],
  aiNote: [2029],
  aiPaymentCorrection: [2054, 2056],
  pendingEntrySave: [2098, 2101],
  entrySave: [2169, 2172],
  draftEntrySave: [2220, 2222],
  undo: [2595, 2596, 2597, 2598, 2599, 2600, 2601],
  whatsappPhone: [2621],
  quickPayment: [2702, 2703],
  jobStatus: [2720],
  customerDeleteCascade: [2744, 2745, 2746, 2747, 2749],
  entryDeleteCascade: [2764, 2765, 2766],
  sample: [2807],
  restoreApplication: [2835, 2836, 2837, 2838, 2839, 2840, 2841],
  reminderSave: [2950],
  reminderComplete: [2990],
  reminderSnooze: [3052],
  inlineCustomerNote: [4545],
  inlineDraftDelete: [4693],
} as const;

export const guardedModeCoverageLines = () => Object.values(GUARDED_MODE_SETTER_COVERAGE).flat();

/** A staging cutover is invalid unless every non-privileged setter is mapped. */
export function verifyAtomicCutoverCoverage(foundLines: number[]) {
  const privileged = new Set<number>(PRIVILEGED_PERSISTED_SETTER_LINES);
  const required = foundLines.filter((line) => !privileged.has(line)).sort((a, b) => a - b);
  const covered = guardedModeCoverageLines().slice().sort((a, b) => a - b);
  return { complete: JSON.stringify(required) === JSON.stringify(covered), required, covered };
}
