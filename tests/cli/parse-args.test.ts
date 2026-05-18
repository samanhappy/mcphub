import { extractFlags, parseGlobalFlags } from '../../src/cli/parse-args.js';
import { CliUsageError } from '../../src/cli/errors.js';

describe('parseGlobalFlags', () => {
  it('extracts valued flags and leaves the subcommand intact', () => {
    const { globalFlags, rest } = parseGlobalFlags([
      '--url',
      'http://hub.test',
      '--token',
      'xyz',
      'servers',
      'list',
    ]);
    expect(globalFlags).toMatchObject({ url: 'http://hub.test', token: 'xyz' });
    expect(rest).toEqual(['servers', 'list']);
  });

  it('parses boolean flags and --flag=value form', () => {
    const { globalFlags, rest } = parseGlobalFlags([
      '--bearer',
      '--profile=prod',
      '--json',
      'servers',
    ]);
    expect(globalFlags.bearer).toBe(true);
    expect(globalFlags.profile).toBe('prod');
    expect(globalFlags.json).toBe(true);
    expect(rest).toEqual(['servers']);
  });

  it('throws CliUsageError when a valued flag is missing its value', () => {
    expect(() => parseGlobalFlags(['--url'])).toThrow(CliUsageError);
  });

  it('passes unknown flags through to rest for subcommand parsing', () => {
    const { rest } = parseGlobalFlags(['servers', 'add', '--from-file', 'x.json']);
    expect(rest).toEqual(['servers', 'add', '--from-file', 'x.json']);
  });
});

describe('extractFlags', () => {
  it('separates positional args from valued and boolean flags', () => {
    const { positional, flags } = extractFlags(
      ['list', '--limit', '10', '--json', 'foo'],
      { valued: ['--limit'], boolean: ['--json'] },
    );
    expect(positional).toEqual(['list', 'foo']);
    expect(flags['--limit']).toBe('10');
    expect(flags['--json']).toBe(true);
  });

  it('supports --name=value form', () => {
    const { flags } = extractFlags(['--limit=5'], { valued: ['--limit'] });
    expect(flags['--limit']).toBe('5');
  });

  it('throws when a valued flag has no value', () => {
    expect(() => extractFlags(['--limit'], { valued: ['--limit'] })).toThrow(CliUsageError);
  });
});
