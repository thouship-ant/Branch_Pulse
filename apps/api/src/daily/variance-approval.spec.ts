import { D } from '../common/money';
import { nextVarianceApproval } from './cash.service';

describe('cash variance approval status', () => {
  const saved = (variance: string, approval: any) => ({ variance: D(variance), variance_approval: approval });

  it('a tallied day, or an uncounted one, needs no approval', () => {
    expect(nextVarianceApproval(null, D(0))).toBeNull();
    expect(nextVarianceApproval(saved('-300', 'APPROVED'), D(0))).toBeNull(); // the difference went away
    expect(nextVarianceApproval(null, null)).toBeNull();
  });

  it('a new difference starts as a draft (the manager must send it)', () => {
    expect(nextVarianceApproval(null, D(-300))).toBe('DRAFT');
    expect(nextVarianceApproval(saved('0', null), D(150))).toBe('DRAFT');
  });

  it('a sent or approved variance stays as it is while the figure is unchanged', () => {
    expect(nextVarianceApproval(saved('-300', 'SUBMITTED'), D(-300))).toBe('SUBMITTED');
    expect(nextVarianceApproval(saved('-300', 'APPROVED'), D(-300))).toBe('APPROVED');
    expect(nextVarianceApproval(saved('-300', 'DRAFT'), D(-300))).toBe('DRAFT');
  });

  it('a changed figure withdraws a sent or approved decision and goes back to a draft', () => {
    expect(nextVarianceApproval(saved('-300', 'SUBMITTED'), D(-200))).toBe('DRAFT');
    expect(nextVarianceApproval(saved('-300', 'APPROVED'), D(-600))).toBe('DRAFT');
  });

  it('a rejected variance returns to draft once the manager corrects the record', () => {
    expect(nextVarianceApproval(saved('-300', 'REJECTED'), D(-300))).toBe('DRAFT');
  });
});
