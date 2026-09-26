import { toDate } from '../common/dates';
import { bucketKeys, bucketStart } from './expense-report.service';

describe('expense report buckets', () => {
  it('a day is its own bucket; a week starts on Monday; a month on the 1st', () => {
    const wed = toDate('2026-09-23');
    expect(bucketStart(wed, 'day')).toBe('2026-09-23');
    expect(bucketStart(wed, 'week')).toBe('2026-09-21');
    expect(bucketStart(toDate('2026-09-27'), 'week')).toBe('2026-09-21'); // Sunday belongs to the week before Monday 28th
    expect(bucketStart(toDate('2026-09-28'), 'week')).toBe('2026-09-28');
    expect(bucketStart(wed, 'month')).toBe('2026-09-01');
  });

  it('lists every bucket in range, including quiet ones and across a year end', () => {
    expect(bucketKeys(toDate('2026-09-01'), toDate('2026-09-03'), 'day')).toEqual(['2026-09-01', '2026-09-02', '2026-09-03']);
    expect(bucketKeys(toDate('2026-09-23'), toDate('2026-10-06'), 'week')).toEqual(['2026-09-21', '2026-09-28', '2026-10-05']);
    expect(bucketKeys(toDate('2026-11-15'), toDate('2027-02-02'), 'month')).toEqual(['2026-11-01', '2026-12-01', '2027-01-01', '2027-02-01']);
  });
});
