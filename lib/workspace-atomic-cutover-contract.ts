/**
 * Dormant coverage contract for the one-shot guarded-reducer cutover. These
 * are current app/workspace.tsx line numbers, intentionally audited by a test.
 * The live application does not import this module.
 */
export const PRIVILEGED_PERSISTED_SETTER_LINES = [741, 742, 743, 744, 745, 746, 747, 1800, 1801, 1802, 1803, 1804] as const;

export const GUARDED_MODE_SETTER_COVERAGE = {
  profile: [503, 504],
  reminderDelete: [1592],
  aiReminder: [1922],
  aiNote: [1965],
  aiPaymentCorrection: [1990, 1992],
  pendingEntrySave: [2034, 2037],
  entrySave: [2105, 2108],
  draftEntrySave: [2156, 2158],
  undo: [2530, 2531, 2532, 2533, 2534, 2535, 2536],
  whatsappPhone: [2556],
  quickPayment: [2637, 2638],
  jobStatus: [2655],
  customerDeleteCascade: [2679, 2680, 2681, 2682, 2684],
  entryDeleteCascade: [2699, 2700, 2701],
  sample: [2742],
  restoreApplication: [2770, 2771, 2772, 2773, 2774, 2775, 2776],
  reminderSave: [2883],
  reminderComplete: [2923],
  reminderSnooze: [2985],
  inlineCustomerNote: [4478],
  inlineDraftDelete: [4626],
} as const;

export const guardedModeCoverageLines = () => Object.values(GUARDED_MODE_SETTER_COVERAGE).flat();

/** A staging cutover is invalid unless every non-privileged setter is mapped. */
export function verifyAtomicCutoverCoverage(foundLines: number[]) {
  const privileged = new Set<number>(PRIVILEGED_PERSISTED_SETTER_LINES);
  const required = foundLines.filter((line) => !privileged.has(line)).sort((a, b) => a - b);
  const covered = guardedModeCoverageLines().slice().sort((a, b) => a - b);
  return { complete: JSON.stringify(required) === JSON.stringify(covered), required, covered };
}
