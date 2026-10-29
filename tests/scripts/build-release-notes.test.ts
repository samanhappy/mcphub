import { execFileSync } from 'child_process';
import fs from 'fs';
import os from 'os';
import path from 'path';

const projectRoot = path.resolve(__dirname, '../..');
const scriptPath = path.join(projectRoot, 'scripts', 'build-release-notes.js');

// The script shells out to `gh`. Stub it through PATH so the test is offline
// and deterministic. POSIX-only: a shebang stub cannot be executed on Windows.
const describePosix = process.platform === 'win32' ? describe.skip : describe;

interface StubPR {
  number: number;
  title?: string;
  author?: { login: string };
  url?: string;
  mergedAt: string;
}

interface GhStubConfig {
  bodies: Record<string, string>;
  publishedAt: Record<string, string>;
  mergedPRs: StubPR[];
  search: Record<string, StubPR[]>;
}

const GH_STUB = `#!/usr/bin/env node
const fs = require('fs');
const config = JSON.parse(fs.readFileSync(process.env.STUB_GH_CONFIG, 'utf8'));
const args = process.argv.slice(2);
fs.appendFileSync(process.env.STUB_GH_CALLS, args.join(' ') + '\\n');

function emit(value) {
  process.stdout.write(value);
}

function fail() {
  process.stderr.write('stub gh: unexpected call: ' + args.join(' ') + '\\n');
  process.exit(1);
}

if (args[0] === 'release' && args[1] === 'view') {
  const tag = args[2];
  if (args.includes('publishedAt')) emit(config.publishedAt[tag] || '');
  else if (args.includes('body')) emit(config.bodies[tag] || '');
  else fail();
  process.exit(0);
}

if (args[0] === 'pr' && args[1] === 'list') {
  const searchIndex = args.indexOf('--search');
  const query = searchIndex === -1 ? null : args[searchIndex + 1];
  const result = query === null ? config.mergedPRs : config.search[query] || [];
  emit(JSON.stringify(result));
  process.exit(0);
}

fail();
`;

const PREV_TAG = 'v1.1.13';
const TAG = 'v1.1.14';
// v1.1.13 published 09:12:29Z; #1400 merged later the same day, so it belongs
// to the v1.1.14 range even though the calendar date is shared.
const PREV_PUBLISHED_AT = '2026-10-28T09:12:29Z';
const TAG_PUBLISHED_AT = '2026-10-29T14:03:26Z';

const MERGED_PRS: StubPR[] = [
  {
    number: 1410,
    title: 'fix: cache context definition costs and avoid polling refetches',
    author: { login: 'samanhappy' },
    url: 'https://github.com/samanhappy/mcphub/pull/1410',
    mergedAt: '2026-10-29T13:28:19Z',
  },
  {
    number: 1400,
    title: 'fix: strip UTF-8 BOM when reading mcp_settings.json',
    author: { login: 'jaeminbird' },
    url: 'https://github.com/samanhappy/mcphub/pull/1400',
    mergedAt: '2026-10-28T09:56:42Z',
  },
];

function makeBody(newContributors?: string): string {
  const section = newContributors ? `## New Contributors\n\n${newContributors}\n\n` : '';
  return `## What's Changed
* fix: cache context definition costs and avoid polling refetches by @samanhappy in https://github.com/samanhappy/mcphub/pull/1410
* fix: strip UTF-8 BOM when reading mcp_settings.json by @jaeminbird in https://github.com/samanhappy/mcphub/pull/1400

${section}**Full Changelog**: https://github.com/samanhappy/mcphub/compare/${PREV_TAG}...${TAG}`;
}

function baseConfig(body: string): GhStubConfig {
  return {
    bodies: { [TAG]: body, [PREV_TAG]: '' },
    publishedAt: { [TAG]: TAG_PUBLISHED_AT, [PREV_TAG]: PREV_PUBLISHED_AT },
    mergedPRs: MERGED_PRS,
    search: {},
  };
}

function runBuilder(tag: string, config: GhStubConfig): { stdout: string; calls: string[] } {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'build-release-notes-'));
  const binDir = path.join(dir, 'bin');
  fs.mkdirSync(binDir);
  const stubPath = path.join(binDir, 'gh');
  fs.writeFileSync(stubPath, GH_STUB);
  fs.chmodSync(stubPath, 0o755);
  const configPath = path.join(dir, 'gh-stub.json');
  fs.writeFileSync(configPath, JSON.stringify(config));
  const callsPath = path.join(dir, 'calls.log');
  try {
    const stdout = execFileSync(process.execPath, [scriptPath, tag], {
      cwd: projectRoot,
      encoding: 'utf8',
      env: {
        ...process.env,
        PATH: `${binDir}${path.delimiter}${process.env.PATH ?? ''}`,
        STUB_GH_CONFIG: configPath,
        STUB_GH_CALLS: callsPath,
      },
    });
    const calls = fs.readFileSync(callsPath, 'utf8').split('\n').filter(Boolean);
    return { stdout, calls };
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

describePosix('build-release-notes', () => {
  it('reuses New Contributors from the raw body regardless of bullet style or URL form', () => {
    const body = makeBody(
      [
        '* @jaeminbird made their first contribution in https://github.com/samanhappy/mcphub/pull/1400',
        '- @myml made their first contribution in #1404',
      ].join('\n'),
    );
    const { stdout, calls } = runBuilder(TAG, baseConfig(body));

    expect(stdout).toContain('- @jaeminbird made their first contribution in #1400');
    expect(stdout).toContain('- @myml made their first contribution in #1404');
    expect(stdout).not.toContain('@samanhappy made their first contribution');
    // Reuse must not fall back to per-author contributor lookups.
    expect(calls.some((call) => call.includes('--search'))).toBe(false);
  });

  it('detects a contributor whose only PR merged later on the previous release day', () => {
    const { stdout, calls } = runBuilder(TAG, {
      ...baseConfig(makeBody()),
      search: {
        'author:jaeminbird merged:<2026-10-28': [],
        'author:jaeminbird merged:2026-10-28..2026-10-28': [
          { number: 1400, mergedAt: '2026-10-28T09:56:42Z' },
        ],
        'author:samanhappy merged:<2026-10-28': [{ number: 1393, mergedAt: '2026-10-27T16:03:43Z' }],
      },
    });

    expect(stdout).toContain('- @jaeminbird made their first contribution in #1400');
    expect(stdout).not.toContain('@samanhappy made their first contribution');
    expect(calls.some((call) => call.includes('merged:<2026-10-28'))).toBe(true);
    expect(calls.some((call) => call.includes('merged:2026-10-28..2026-10-28'))).toBe(true);
  });

  it('does not treat a same-day PR merged before the previous release as new', () => {
    const body = makeBody();
    const config = baseConfig(body);
    const mymlPR: StubPR = {
      number: 1404,
      title: 'fix(i18n): let the browser locale win over the static html lang',
      author: { login: 'myml' },
      url: 'https://github.com/samanhappy/mcphub/pull/1404',
      mergedAt: '2026-10-29T02:56:55Z',
    };
    const { stdout } = runBuilder(TAG, {
      ...config,
      mergedPRs: [...config.mergedPRs, mymlPR],
      search: {
        'author:jaeminbird merged:<2026-10-28': [],
        'author:jaeminbird merged:2026-10-28..2026-10-28': [
          { number: 1400, mergedAt: '2026-10-28T09:56:42Z' },
        ],
        'author:myml merged:<2026-10-28': [],
        'author:myml merged:2026-10-28..2026-10-28': [
          { number: 1398, mergedAt: '2026-10-28T08:00:00Z' },
        ],
        'author:samanhappy merged:<2026-10-28': [{ number: 1393, mergedAt: '2026-10-27T16:03:43Z' }],
      },
    });

    expect(stdout).toContain('- @jaeminbird made their first contribution in #1400');
    expect(stdout).not.toContain('@myml made their first contribution');
  });

  it('renders References from the compare line in the existing body', () => {
    const { stdout } = runBuilder(TAG, baseConfig(makeBody()));

    expect(stdout).toContain(
      '- fix: cache context definition costs and avoid polling refetches by @samanhappy in https://github.com/samanhappy/mcphub/pull/1410',
    );
    expect(stdout).toContain(
      '- fix: strip UTF-8 BOM when reading mcp_settings.json by @jaeminbird in https://github.com/samanhappy/mcphub/pull/1400',
    );
    expect(stdout).toContain(
      '- Full changelog: https://github.com/samanhappy/mcphub/compare/v1.1.13...v1.1.14',
    );
  });
});
