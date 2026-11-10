import { addDays, toIsoDate } from './dates';

describe('toIsoDate', () => {
  it('formats the local calendar date as YYYY-MM-DD', () => {
    expect(toIsoDate(new Date(2026, 3, 5, 23, 30))).toBe('2026-04-05');
    expect(toIsoDate(new Date(2026, 11, 31, 0, 5))).toBe('2026-12-31');
  });
});

describe('addDays', () => {
  it('moves by calendar days across month and year ends', () => {
    expect(toIsoDate(addDays(new Date(2026, 11, 30, 15), 7))).toBe('2027-01-06');
    expect(toIsoDate(addDays(new Date(2026, 2, 1), -1))).toBe('2026-02-28');
  });

  it('is not thrown off by daylight-saving changes', () => {
    // Europe switches to summer time on 2026-03-29.
    expect(toIsoDate(addDays(new Date(2026, 2, 28), 2))).toBe('2026-03-30');
  });
});
