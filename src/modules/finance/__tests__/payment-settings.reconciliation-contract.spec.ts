import { summarizeReconciliation } from '../services/payment-reconciliation-batch';
describe('Persisted reconciliation batch compatibility', () => {
  it.each([
    ['SUCCEEDED', 'SUCCEEDED', 'SUCCEEDED'],
    ['FAILED', 'FAILED', 'FAILED'],
    ['FAILED', 'SUCCEEDED', 'PARTIAL'],
    ['PARTIAL', 'SUCCEEDED', 'PARTIAL'],
  ])('summarizes %s / %s as %s', (a, b, expected) => {
    const result = summarizeReconciliation([
      { status: a, backfilledCount: 2, fetchedCount: 3 },
      { status: b, backfilledCount: 0, fetchedCount: 4 },
    ]);
    expect(result.status).toBe(expected);
    expect(result.counts.backfilledCount).toBe(2);
    expect(result.counts.fetchedCount).toBe(7);
    expect(Object.keys(result.counts)).toHaveLength(7);
  });
  it('refuses an empty successful batch', () => {
    expect(() => summarizeReconciliation([])).toThrow();
  });
});
