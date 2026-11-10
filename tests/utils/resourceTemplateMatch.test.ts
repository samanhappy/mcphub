import { UriTemplate } from '@modelcontextprotocol/client';
import { uriMatchesResourceTemplate } from '../../src/utils/resourceTemplateMatch.js';

describe('uriMatchesResourceTemplate', () => {
  it.each([
    ['x://items/{id}', 'x://items/42', true],
    ['x://items/{id}', 'x://items/42/extra', false],
    ['x://items/{id}', 'y://items/42', false],
    ['paperless://documents/{id}/{resource}', 'paperless://documents/69/download', true],
    ['paperless://documents/{id}/{resource}', 'paperless://documents/69/thumb', true],
    ['x://docs/{id}/download{?original}', 'x://docs/69/download', true],
    ['x://docs/{id}/download{?original}', 'x://docs/69/download?original=true', true],
    ['x://docs/{id}/download{?original}', 'x://docs/69/download?other=1', false],
    ['x://docs/{id}/download{?original}', 'x://docs/69/thumb', false],
    ['x://search{?q,limit}', 'x://search', true],
    ['x://search{?q,limit}', 'x://search?limit=5', true],
    ['x://search{?q,limit}', 'x://search?limit=5&q=a', true],
    ['x://search{?q}{&limit}', 'x://search?q=a&limit=5', true],
    ['x://search{?q}{&limit}', 'x://search?page=2', false],
    ['x://search{?filters*}', 'x://search?any=1', true],
    ['x://search?fixed=1{&limit}', 'x://search?fixed=1', false],
    ['x://items/{id', 'x://items/1', false],
    ['x://{a}{b}', 'x://\u{1F600}', true],
    ['x://\u{1F600}/{a}', 'x://\u{1F600}/1', true],
  ])('%s vs %s -> %s', (template, uri, expected) => {
    expect(uriMatchesResourceTemplate(template, uri)).toBe(expected);
  });

  it('rejects over-long templates', () => {
    expect(uriMatchesResourceTemplate(`x://${'{a}'.repeat(200)}`, 'x://a')).toBe(false);
  });

  it('rejects over-long URIs', () => {
    expect(uriMatchesResourceTemplate('x://items/{id}', `x://items/${'a'.repeat(5000)}`)).toBe(
      false,
    );
  });

  it.each([
    ['x://items/{id}{?q}', `x://items/42?q=${'a?q='.repeat(1000)}&other=1`],
    ['cal://{year}-{month}-{day}', `cal://${'-'.repeat(4000)}/`],
    ['x://{a}_{b}_{c}_{d}', `x://${'_'.repeat(4000)}/`],
    ['x://{+a}{+b}{+c}{?q}', `x://${'a'.repeat(4000)}?`],
  ])('matches %s in linear time', (template, uri) => {
    const started = performance.now();
    uriMatchesResourceTemplate(template, uri);
    expect(performance.now() - started).toBeLessThan(200);
  });

  it('agrees with the SDK matcher', () => {
    let seed = 42;
    const random = (n: number) => {
      seed = (seed * 1103515245 + 12345) % 2 ** 31;
      return seed % n;
    };
    const pick = <T>(items: T[]) => items[random(items.length)];
    const pieces = [
      'x',
      '-',
      '/',
      ',',
      '.',
      '?',
      '&',
      '=',
      '{a}',
      '{+b}',
      '{#c}',
      '{.d}',
      '{/e}',
      '{f*}',
      '{/g*}',
      '{?h}',
      '{&i}',
      '{?j,k}',
      '{.d*}',
      '{+b*}',
    ];
    const chars = [
      'x',
      'y',
      '-',
      '/',
      ',',
      '.',
      '?',
      '&',
      '=',
      'h',
      'i',
      'j',
      'k',
      '\n',
      '\u2028',
      '\u{1F600}',
      '\uD83D',
    ];
    let compared = 0;
    for (let t = 0; t < 400; t++) {
      const template = Array.from({ length: 1 + random(5) }, () => pick(pieces)).join('');
      const sdk = new UriTemplate(template);
      const hasTrailingQuery = /\{[?&][^}]*\}$/.test(template);
      for (let u = 0; u < 60; u++) {
        const uri = Array.from({ length: random(9) }, () => pick(chars)).join('');
        const expected = sdk.match(uri) !== null;
        const actual = uriMatchesResourceTemplate(template, uri);
        if (expected) {
          expect({ template, uri, actual }).toEqual({ template, uri, actual: true });
        } else if (!hasTrailingQuery) {
          expect({ template, uri, actual }).toEqual({ template, uri, actual: false });
        }
        compared++;
      }
    }
    expect(compared).toBe(24_000);
  });

  it('rejects non-string input', () => {
    expect(uriMatchesResourceTemplate(undefined as unknown as string, 'x://a')).toBe(false);
    expect(uriMatchesResourceTemplate('x://a', undefined as unknown as string)).toBe(false);
  });
});
