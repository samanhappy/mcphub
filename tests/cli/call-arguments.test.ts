import { parseCallArguments } from '../../src/cli/call-arguments.js';

describe('parseCallArguments', () => {
  it('coerces numbers, booleans, and null by default', () => {
    const { args } = parseCallArguments(['n=42', 'f=3.14', 'b=true', 'no=false', 'z=null']);
    expect(args).toEqual({ n: 42, f: 3.14, b: true, no: false, z: null });
  });

  it('keeps plain strings as strings', () => {
    const { args } = parseCallArguments(['name=alice', 'city=New York']);
    expect(args).toEqual({ name: 'alice', city: 'New York' });
  });

  it('parses JSON literals for objects and arrays', () => {
    const { args } = parseCallArguments(['obj={"a":1}', 'arr=[1,2,3]']);
    expect(args).toEqual({ obj: { a: 1 }, arr: [1, 2, 3] });
  });

  it('falls back to string when brace content is not valid JSON', () => {
    const { args } = parseCallArguments(['raw={not-json}']);
    expect(args).toEqual({ raw: '{not-json}' });
  });

  it('@<missing-file> raises a friendly CliUsageError', () => {
    const fakeFs = {
      readFileSync: () => {
        const err = new Error('ENOENT: no such file or directory');
        throw err;
      },
    } as any;
    expect(() =>
      parseCallArguments(['payload=@/no/such.json'], { fs: fakeFs }),
    ).toThrow(/Failed to read file \/no\/such\.json/);
  });

  it('@path loads JSON from a file', () => {
    const fakeFs = {
      readFileSync: (p: any) => {
        expect(String(p)).toBe('/tmp/p.json');
        return JSON.stringify({ deep: { v: 1 } });
      },
    } as any;
    const { args } = parseCallArguments(['payload=@/tmp/p.json'], { fs: fakeFs });
    expect(args).toEqual({ payload: { deep: { v: 1 } } });
  });

  it('--no-coerce disables type coercion', () => {
    const { args } = parseCallArguments(['n=42', 'b=true'], { noCoerce: true });
    expect(args).toEqual({ n: '42', b: 'true' });
  });

  it('tokens without "=" are returned as extras', () => {
    const { args, extra } = parseCallArguments(['k=v', 'leftover']);
    expect(args).toEqual({ k: 'v' });
    expect(extra).toEqual(['leftover']);
  });

  it('preserves leading-zero strings (phone numbers, zip codes)', () => {
    const { args } = parseCallArguments(['phone=0123']);
    expect(args).toEqual({ phone: '0123' });
  });

  it('preserves explicit JSON-string form key="42"', () => {
    const { args } = parseCallArguments(['v="42"']);
    expect(args).toEqual({ v: '42' });
  });
});
