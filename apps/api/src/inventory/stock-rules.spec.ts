import { D } from '../common/money';
import { emptyFlow, expectedOf } from './flows';
import { isSignificantVariance, stockVarianceLabel } from './reconciliation.service';

describe('stock reconciliation rules', () => {
  it('expected closing = opening + purchases + transfers in - transfers out - consumption - wastage (+ other)', () => {
    const f = { ...emptyFlow(), opening: D('100'), purchases: D('20'), transfersIn: D('10'), transfersOut: D('5'), consumption: D('30'), wastage: D('3'), other: D('-1') };
    expect(expectedOf(f).toString()).toBe('91'); // 100 + 20 + 10 - 5 - 30 - 3 - 1
    expect(expectedOf(emptyFlow()).toString()).toBe('0');
  });

  it('a count below the books is a shortage, above is an excess, equal is tallied', () => {
    expect(stockVarianceLabel(D('-1'))).toBe('SHORTAGE');
    expect(stockVarianceLabel(D('0.5'))).toBe('EXCESS');
    expect(stockVarianceLabel(D('0'))).toBe('TALLIED');
  });

  it('significance: the item quantity limit wins, then its own percentage, then the shop default', () => {
    const none = { pct: null, qty: null };
    expect(isSignificantVariance(D('0'), D('1000'), none, D('5'))).toBe(false);
    expect(isSignificantVariance(D('-50'), D('1000'), none, D('5'))).toBe(false); // exactly 5%: not over the limit
    expect(isSignificantVariance(D('-51'), D('1000'), none, D('5'))).toBe(true);
    expect(isSignificantVariance(D('-51'), D('1000'), { pct: D('10'), qty: null }, D('5'))).toBe(false); // the item allows 10%
    expect(isSignificantVariance(D('-51'), D('1000'), { pct: D('10'), qty: D('40') }, D('5'))).toBe(true); // ...but only 40 units
    expect(isSignificantVariance(D('100'), D('0'), none, D('5'))).toBe(true); // counted stock the books say does not exist
  });
});
