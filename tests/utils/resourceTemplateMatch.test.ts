import { UriTemplate } from '@modelcontextprotocol/client';
import { uriMatchesResourceTemplate } from '../../src/utils/resourceTemplateMatch.js';

// Seeded mulberry32, returning an integer below n.
const seededRandom = (seed: number) => (n: number) => {
  seed = (seed + 0x6d2b79f5) | 0;
  let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return Math.floor((((t ^ (t >>> 14)) >>> 0) / 2 ** 32) * n);
};

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
    ['x://search?fixed=1{&limit}', 'x://search?fixed=1', true],
    ['x://search?fixed=1{&limit}', 'x://search?fixed=1&limit=5', true],
    ['x://search?fixed=1{&limit}', 'x://search?fixed=1&other=5', false],
    ['x://search?fixed=1{&limit}', 'x://search?fixed=2', false],
    ['x://search?fixed=1{&limit}', 'x://search', false],
    ['x://search?fixed={f}{&a,b}', 'x://search?fixed=1&b=2', true],
    ['x://search?fixed={f}{&a,b}', 'x://search?fixed=1&b=2&a=1', true],
    ['x://search?fixed=1{&a,b}', 'x://search?fixed=1&b=2&c=3', false],
    ['x://search?fixed=1{&rest*}', 'x://search?fixed=1&any=1', true],
    ['x://search?fixed=1{&rest*}', 'x://search?fixed=1&', false],
    ['x://search?fixed=1{&rest*}', 'x://search?fixed=1&&&', false],
    ['x://search{?filters*}', 'x://search?a=1&&b=2', false],
    ['x://search{?q}/page{&limit}', 'x://search?q=a/page', true],
    ['x://search{?q}{&limit}', 'x://search&limit=5', true],
    ['x://search{?a,b}', 'x://search?a=1&?b=2', false],
    ['x://search{?a,b}', 'x://search??a=1', false],
    ['x://search?fixed=1{&a}', 'x://search?fixed=1&?a=2', false],
    ['x://search?fixed=1{&a,b}', 'x://search?fixed=1&a?b=2', false],
    ['x://search?fixed=1{&a,b}', 'x://search?fixed=1&b=foo?bar', true],
    ['x://search?fixed=1{&a,b}', 'x://search?fixed=1&a=foo?bar=1', true],
    ['x://search?fixed=1{&a,b}', 'x://search?fixed=1&=1', false],
    ['x://search?fixed=1{?b}', 'x://search?fixed=1?b=2', true],
    ['x://search{?a,b}', 'x://search?a?b=1', false],
    ['x://items/{id}{?q}', 'x://items/1?', true],
    ['x://{+h}/items/{id}{?q}', 'x://h/items/5?', true],
    ['x://search?fixed=1{&rest*}', 'x://search?fixed=1&=1', false],
    ['x://search{?filters*}', 'x://search?=1', false],
    ['x://items/{id}{?q}', 'x://items/1?q=1&', false],
    ['x://{+h}/items/{id}{?q}', 'x://h/items/5?zzz=1', false],
    ['x://s/{a}{+p}{?q,r}', 'x://s/?x?q=1', false],
    ['x://{+h}/items/{id}{?q}', 'x://h/items/5?q=1', true],
    ['x://s?a={m}/p/{id}{&k}', 'x://s?a=1/p/5?zz=1', false],
    ['x://s?a={m}/p/{id}{&k}', 'x://s?a=1/p/5', true],
    ['x://s?fixed={a,b}{&q,r}', 'x://s?fixed=foo?bar&q=1', true],
    ['x://{a,b}{?q}', 'x://f?x', true],
    ['x://s?f=1/{a,g}{&k}', 'x://s?f=1/p?q', true],
    ['x://search?fixed=1{&a}', 'x://search?fixed=1&', false],
    ['x://search{?a,b}', 'x://search?a=1&&b=2', false],
    ['x://{+path}{?a,b}', 'x://search?fixed=1', true],
    ['x://{+path}{?a,b}', 'x://search?fixed=1&b=2', true],
    ['x://{#f}{?j}', 'x://#a?z', true],
    ['x://s{?a:3,b}', 'x://s?a:3=v', true],
    ['x://s{?a:3,b}', 'x://s?a=v', true],
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
    ['x://s?f={f}{&q}', `x://s?f=${'&'.repeat(4000)}`],
    ['x://s?f={+f}{&q*}', `x://s?f=${'&?'.repeat(2000)}/`],
  ])('matches %s in linear time', (template, uri) => {
    const started = performance.now();
    uriMatchesResourceTemplate(template, uri);
    expect(performance.now() - started).toBeLessThan(200);
  });

  it('agrees with the SDK matcher', () => {
    const random = seededRandom(42);
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

  it('matches SDK expansions that omit trailing query variables', () => {
    const random = seededRandom(7);
    const pick = <T>(items: T[]) => items[random(items.length)];
    const basePieces = [
      'x',
      '-',
      '/',
      '.',
      '?',
      '&',
      'x=1',
      '{a}',
      '{+b}',
      '{#c}',
      '{.d}',
      '{/e}',
      '{?h}',
      '{s,t}',
    ];
    const queryPieces = ['{?j}', '{&k}', '{?l,m}', '{&n,o}'];
    const queryNames = new Set(['j', 'k', 'l', 'm', 'n', 'o']);
    const reservedValues = ['v', 'p?q=1', 'p&q', 'p/q'];
    const templates = new Set<string>();
    let compared = 0;
    let omitted = 0;
    let queryInBase = 0;
    for (let t = 0; t < 3000; t++) {
      const base = Array.from({ length: 1 + random(4) }, () => pick(basePieces)).join('');
      const template =
        base + Array.from({ length: 1 + random(3) }, () => pick(queryPieces)).join('');
      const sdk = new UriTemplate(template);
      const values = Object.fromEntries(
        // The SDK's own regex cannot match both values of `{s,t}` (joined by `,`).
        sdk.variableNames
          .filter((name) => name !== 't')
          .map((name) => [name, 'bcs'.includes(name) ? pick(reservedValues) : 'v']),
      );
      // Only the base must round-trip; trailing query expansions are what is under test.
      const baseSdk = new UriTemplate(base);
      if (!baseSdk.match(baseSdk.expand(values))) continue;
      templates.add(template);
      for (let u = 0; u < 8; u++) {
        const subset = Object.fromEntries(
          Object.entries(values).filter(([name]) => !queryNames.has(name) || random(2) === 0),
        );
        const uri = sdk.expand(subset);
        expect({ template, uri, actual: uriMatchesResourceTemplate(template, uri) }).toEqual({
          template,
          uri,
          actual: true,
        });
        compared++;
        if (Object.keys(subset).length < Object.keys(values).length) {
          omitted++;
          if (/[?+#]|\{s,t\}/.test(base)) queryInBase++;
        }
      }
    }
    expect(templates.size).toBeGreaterThan(1000);
    expect(omitted).toBeGreaterThan(5000);
    expect(queryInBase).toBeGreaterThan(1000);
  });

  it('rejects undeclared query keys after a literal base', () => {
    const random = seededRandom(11);
    const pick = <T>(items: T[]) => items[random(items.length)];
    const basePieces = ['x', '-', '/', '.', '?', '&', 'x=1'];
    const queryPieces = ['{?j}', '{&k}', '{?l,m}', '{&n,o}'];
    let compared = 0;
    for (let t = 0; t < 2000; t++) {
      const template =
        Array.from({ length: 1 + random(4) }, () => pick(basePieces)).join('') +
        Array.from({ length: 1 + random(3) }, () => pick(queryPieces)).join('');
      const sdk = new UriTemplate(template);
      const values = Object.fromEntries(
        sdk.variableNames.filter(() => random(2) === 0).map((name) => [name, 'v']),
      );
      const uri = sdk.expand(values);
      const renamed = uri.replace(/([?&])[j-o]=/, '$1zz=');
      const declared = sdk.variableNames.filter((name) => /^[j-o]$/.test(name));
      const joined = `${declared[0]}?${declared[declared.length - 1]}`;
      for (const bad of [
        `${uri}&zz=1`,
        `${uri}&${joined}=1`,
        renamed === uri ? `${uri}&=1` : renamed,
      ]) {
        expect({ template, bad, actual: uriMatchesResourceTemplate(template, bad) }).toEqual({
          template,
          bad,
          actual: false,
        });
        compared++;
      }
    }
    expect(compared).toBe(6000);
  });

  it('rejects non-string input', () => {
    expect(uriMatchesResourceTemplate(undefined as unknown as string, 'x://a')).toBe(false);
    expect(uriMatchesResourceTemplate('x://a', undefined as unknown as string)).toBe(false);
  });
});
