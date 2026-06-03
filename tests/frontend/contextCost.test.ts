import { formatTokens, percentSaved } from '../../frontend/src/utils/contextCost';

describe('formatTokens', () => {
  it('formats small counts as plain integers', () => {
    expect(formatTokens(0)).toBe('0');
    expect(formatTokens(940)).toBe('940');
  });
  it('formats thousands with a k suffix and one decimal', () => {
    expect(formatTokens(4200)).toBe('4.2k');
    expect(formatTokens(12000)).toBe('12.0k');
  });
});

describe('percentSaved', () => {
  it('returns the integer percent reduction from direct to smart', () => {
    expect(percentSaved(4200, 180)).toBe(96);
  });
  it('returns 0 when direct is 0 (no basis for comparison)', () => {
    expect(percentSaved(0, 0)).toBe(0);
  });
  it('never returns negative (PD can exceed base; clamp at 0)', () => {
    expect(percentSaved(100, 130)).toBe(0);
  });
});
