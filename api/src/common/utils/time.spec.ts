import { dhakaDayRange } from './time';

describe('Dhaka date filters', () => {
  it('maps a Dhaka calendar day into a UTC half-open interval', () => {
    const range = dhakaDayRange('2026-10-24', 'Asia/Dhaka');
    expect(range.start.toISOString()).toBe('2026-10-23T18:00:00.000Z');
    expect(range.end.toISOString()).toBe('2026-10-24T18:00:00.000Z');
  });

  it.each(['2026-02-30', '24-10-2026', ''])(
    'rejects an invalid date value (%s)',
    (value) => {
      expect(() => dhakaDayRange(value)).toThrow('date');
    },
  );
});
