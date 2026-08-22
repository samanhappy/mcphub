import { normalizeBasePath } from '../../src/utils/basePath.js';

describe('normalizeBasePath', () => {
  it.each([
    ['/mcphub/', '/mcphub'],
    ['/mcphub////', '/mcphub'],
    ['mcphub', '/mcphub'],
    ['/', ''],
    ['', ''],
    [undefined, ''],
  ])('normalizes %p to %p', (value, expected) => {
    expect(normalizeBasePath(value)).toBe(expected);
  });
});
