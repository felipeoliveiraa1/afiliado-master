import { describe, expect, it } from 'vitest';
import { scoreOffer } from '@/curator/score.js';

describe('scoreOffer', () => {
  it('returns 0 for an offer with no signals', () => {
    const actual = scoreOffer({
      discountPct: null,
      rating: null,
      salesCount: null,
      commissionPct: null,
    });
    expect(actual).toBe(0);
  });

  it('weights discount the most (40%)', () => {
    const onlyDiscount = scoreOffer({
      discountPct: 70,
      rating: null,
      salesCount: null,
      commissionPct: null,
    });
    expect(onlyDiscount).toBeCloseTo(0.4, 2);
  });

  it('caps discount at 70% (no overweight beyond)', () => {
    const at70 = scoreOffer({ discountPct: 70, rating: null, salesCount: null, commissionPct: null });
    const at90 = scoreOffer({ discountPct: 90, rating: null, salesCount: null, commissionPct: null });
    expect(at90).toBe(at70);
  });

  it('rewards a perfectly rated offer with 0.20', () => {
    const actual = scoreOffer({ discountPct: null, rating: 5, salesCount: null, commissionPct: null });
    expect(actual).toBeCloseTo(0.2, 2);
  });

  it('combines all signals into 0..1 score', () => {
    const actual = scoreOffer({
      discountPct: 35,
      rating: 4.5,
      salesCount: 1000,
      commissionPct: 10,
    });
    expect(actual).toBeGreaterThan(0.4);
    expect(actual).toBeLessThanOrEqual(1);
  });
});
