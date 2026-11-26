export const reconciliationCountKeys = [
  'fetchedCount',
  'backfilledCount',
  'linkedCount',
  'matchedCount',
  'reviewRequiredCount',
  'ignoredCount',
  'localOnlyCount',
] as const;
export function summarizeReconciliation(
  runs: { status: string; [key: string]: unknown }[],
): { status: string; counts: Record<string, number> } {
  if (!runs.length) throw new Error('NO_MONITORED_ACCOUNT');
  const counts = Object.fromEntries(
    reconciliationCountKeys.map((key) => [
      key,
      runs.reduce(
        (sum, run) => sum + (typeof run[key] === 'number' ? run[key] : 0),
        0,
      ),
    ]),
  );
  return {
    status: runs.every((run) => run.status === 'SUCCEEDED')
      ? 'SUCCEEDED'
      : runs.every((run) => run.status === 'FAILED')
        ? 'FAILED'
        : 'PARTIAL',
    counts,
  };
}
