import { describe, expect, it } from 'vitest';
import { moneyAmounts } from '../src/modules/ai/money.js';
import { explicitWriteIntent, outputReason } from '../src/modules/ai/guard.js';

describe('M06 change 2', () => {
  it('parses composite billion and million amounts', () => {
    expect(moneyAmounts('4 t\u1ef7 100 tri\u1ec7u')).toEqual([4100000000]);
    expect(moneyAmounts('4 t\u1ef7 1')).toEqual([4100000000]);
    expect(moneyAmounts('4 t\u1ec9 100tr')).toEqual([4100000000]);
    expect(moneyAmounts('1 t\u1ef7 850 tri\u1ec7u')).toEqual([1850000000]);
    expect(moneyAmounts('12 tri\u1ec7u 500 ngh\u00ecn')).toEqual([12500000]);
    expect(moneyAmounts('12tr5')).toEqual([12500000]);
  });

  it('keeps invented prices blocked and customer budgets allowed', () => {
    const evidence = [{ id: '1', code: 'CFR-1', name: 'C\u0103n h\u1ed9 2PN', price: 4100000000, availability: 'Available', updated_at: '2026-01-01', location: 'Qu\u1eadn 7', property_type: 'Apartment', bedrooms: null }];
    expect(outputReason('Gi\u00e1 4 t\u1ef7 100 tri\u1ec7u [1].', evidence)).toBeNull();
    expect(outputReason('Gi\u00e1 99 t\u1ef7 [1].', evidence)).toBe('UNSUPPORTED_PRICE');
    expect(outputReason('Ng\u00e2n s\u00e1ch 3 t\u1ef7, c\u0103n n\u00e0y gi\u00e1 4 t\u1ef7 100 tri\u1ec7u [1].', evidence, 'Ng\u00e2n s\u00e1ch 3 t\u1ef7')).toBeNull();
  });

  it('accepts bedroom counts from catalogue names when bedrooms is null', () => {
    const evidence = [{ id: '1', code: 'CFR-1', name: 'C\u0103n h\u1ed9 2PN', price: 4100000000, availability: 'Available', updated_at: '2026-01-01', location: 'Qu\u1eadn 7', property_type: 'Apartment', bedrooms: null }];
    expect(outputReason('C\u0103n h\u1ed9 2 ph\u00f2ng ng\u1ee7 [1].', evidence)).toBeNull();
    expect(outputReason('C\u0103n h\u1ed9 3 ph\u00f2ng ng\u1ee7 [1].', evidence)).toBe('UNSUPPORTED_ROOM_COUNT');
  });

  it('recognizes every explicit write-intent family', () => {
    expect(explicitWriteIntent('Nh\u00e2n vi\u00ean t\u01b0 v\u1ea5n li\u00ean h\u1ec7 gi\u00fap t\u00f4i')).toBe(true);
    expect(explicitWriteIntent('\u0110\u1eb7t l\u1ecbch xem nh\u00e0')).toBe(true);
    expect(explicitWriteIntent('T\u00f4i mu\u1ed1n xem c\u0103n n\u00e0y')).toBe(true);
    expect(explicitWriteIntent('L\u01b0u c\u0103n n\u00e0y')).toBe(true);
  });
});
