import { D, sum } from '../common/money';
import { landedValues } from './purchases.service';

describe('landed cost allocation', () => {
  it('spreads other charges by value and always adds up to the total', () => {
    const v = landedValues([D('600'), D('400')], D('30'));
    expect(v.map(String)).toEqual(['618', '412']);
    expect(sum(v).toString()).toBe('1030');
  });

  it('a discount lowers each line in proportion; the last line absorbs rounding', () => {
    const v = landedValues([D('100'), D('100'), D('100')], D('-10'));
    expect(sum(v).toString()).toBe('290');
    expect(v.map((x) => x.toFixed(2))).toEqual(['96.67', '96.67', '96.66']);
  });

  it('no extra means the line totals are the values', () => {
    expect(landedValues([D('45.5'), D('10')], D('0')).map(String)).toEqual(['45.5', '10']);
  });
});
