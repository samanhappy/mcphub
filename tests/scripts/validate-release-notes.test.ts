import { execFileSync } from 'child_process';
import fs from 'fs';
import os from 'os';
import path from 'path';

const projectRoot = path.resolve(__dirname, '../..');
const scriptPath = path.join(projectRoot, 'scripts', 'validate-release-notes.js');

function runValidator(args: string[], env: NodeJS.ProcessEnv = {}, input?: string) {
  try {
    const stdout = execFileSync(process.execPath, [scriptPath, ...args], {
      cwd: projectRoot,
      env: { ...process.env, ...env },
      encoding: 'utf8',
      input,
    });
    return { status: 0, stdout, stderr: '' };
  } catch (err) {
    const e = err as { status?: number; stdout?: string; stderr?: string };
    return {
      status: e.status ?? 1,
      stdout: e.stdout ?? '',
      stderr: e.stderr ?? '',
    };
  }
}

function withTempFile(content: string, fn: (file: string) => void) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'release-notes-'));
  const file = path.join(dir, 'notes.md');
  fs.writeFileSync(file, content);
  try {
    fn(file);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

const VALID = `## Summary

This release hardens MCPHub's reliability.

## Features

- add provider-neutral smart routing config by @atirna in https://github.com/samanhappy/mcphub/pull/1133

## Fixes

- persist startOnDemand/idleTimeoutMs in database mode by @Rahulsharma0810 in https://github.com/samanhappy/mcphub/pull/1095

## 摘要

本版本提升了 MCPHub 的可靠性。

## 功能

- 使用供应商中立的智能路由配置 by @atirna in https://github.com/samanhappy/mcphub/pull/1133

## 修复

- 数据库模式下持久化 startOnDemand/idleTimeoutMs by @Rahulsharma0810 in https://github.com/samanhappy/mcphub/pull/1095

## New Contributors

- @emecii made their first contribution in #1130

## References

- add provider-neutral smart routing config by @atirna in https://github.com/samanhappy/mcphub/pull/1133
- Full changelog: https://github.com/samanhappy/mcphub/compare/v1.0.34...v1.0.35
`;

describe('validate-release-notes', () => {
  it('accepts a valid bilingual body (file mode)', () => {
    withTempFile(VALID, (file) => {
      const result = runValidator([file]);
      expect(result.status).toBe(0);
      expect(result.stdout).toContain('valid');
    });
  });

  it('accepts a valid body via --stdin', () => {
    const result = runValidator(['--stdin'], {}, VALID);
    expect(result.status).toBe(0);
    expect(result.stdout).toContain('valid');
  });

  it('accepts a valid body via --env', () => {
    const result = runValidator(['--env', 'RELEASE_BODY'], { RELEASE_BODY: VALID });
    expect(result.status).toBe(0);
    expect(result.stdout).toContain('valid');
  });

  it('rejects when a required section is missing', () => {
    const body = VALID.replace('## 摘要', '## Removed');
    withTempFile(body, (file) => {
      const result = runValidator([file]);
      expect(result.status).toBe(1);
      expect(result.stderr).toContain('Missing required');
      expect(result.stderr).toContain('摘要');
    });
  });

  it('rejects an empty required section', () => {
    const body = VALID.replace('## Summary\n\nThis release hardens MCPHub\'s reliability.', '## Summary\n');
    withTempFile(body, (file) => {
      const result = runValidator([file]);
      expect(result.status).toBe(1);
      expect(result.stderr).toContain('Empty required');
    });
  });

  it('rejects an empty optional section (omit instead)', () => {
    const body = `## Summary\n\nHello.\n\n## Features\n\n## Fixes\n\n- x by @a in https://github.com/samanhappy/mcphub/pull/1\n\n## 摘要\n\n你好。\n\n## 功能\n\n- x by @a in https://github.com/samanhappy/mcphub/pull/1\n\n## 修复\n\n- x by @a in https://github.com/samanhappy/mcphub/pull/1\n\n## References\n\n- x by @a in https://github.com/samanhappy/mcphub/pull/1\n- Full changelog: https://github.com/samanhappy/mcphub/compare/v1.0.0...v1.0.1\n`;
    withTempFile(body, (file) => {
      const result = runValidator([file]);
      expect(result.status).toBe(1);
      expect(result.stderr).toContain('Empty optional');
      expect(result.stderr).toContain('Features');
    });
  });

  it('rejects an asymmetric bilingual pair (English without Chinese)', () => {
    const body = VALID.replace('## 功能\n\n- 使用供应商中立的智能路由配置 by @atirna in https://github.com/samanhappy/mcphub/pull/1133\n', '');
    withTempFile(body, (file) => {
      const result = runValidator([file]);
      expect(result.status).toBe(1);
      expect(result.stderr).toContain('Asymmetric');
      expect(result.stderr).toContain('Features / 功能');
    });
  });

  it('rejects sections out of order', () => {
    const body = `## Summary\n\nHello.\n\n## 摘要\n\n你好。\n\n## Features\n\n- x by @a in https://github.com/samanhappy/mcphub/pull/1\n\n## 功能\n\n- x by @a in https://github.com/samanhappy/mcphub/pull/1\n\n## References\n\n- x by @a in https://github.com/samanhappy/mcphub/pull/1\n- Full changelog: https://github.com/samanhappy/mcphub/compare/v1.0.0...v1.0.1\n`;
    withTempFile(body, (file) => {
      const result = runValidator([file]);
      expect(result.status).toBe(1);
      expect(result.stderr).toContain('out of order');
    });
  });

  it('rejects malformed References bullets', () => {
    const body = `## Summary\n\nHello.\n\n## 摘要\n\n你好。\n\n## References\n\n- add provider-neutral smart routing config (no author/url)\n- Full changelog: https://github.com/samanhappy/mcphub/compare/v1.0.0...v1.0.1\n`;
    withTempFile(body, (file) => {
      const result = runValidator([file]);
      expect(result.status).toBe(1);
      expect(result.stderr).toContain('References bullets');
    });
  });

  it('rejects a References section without the Full changelog line', () => {
    const body = VALID.replace('- Full changelog: https://github.com/samanhappy/mcphub/compare/v1.0.34...v1.0.35\n', '');
    withTempFile(body, (file) => {
      const result = runValidator([file]);
      expect(result.status).toBe(1);
      expect(result.stderr).toContain('Full changelog');
    });
  });

  it('rejects malformed New Contributors bullets', () => {
    const body = VALID.replace('@emecii made their first contribution in #1130', '@emecii first PR #1130');
    withTempFile(body, (file) => {
      const result = runValidator([file]);
      expect(result.status).toBe(1);
      expect(result.stderr).toContain('New Contributors');
    });
  });

  it('rejects placeholder content (None / 无 / <<FILL)', () => {
    const withNone = VALID.replace(
      '- persist startOnDemand/idleTimeoutMs in database mode by @Rahulsharma0810 in https://github.com/samanhappy/mcphub/pull/1095',
      '- None',
    );
    withTempFile(withNone, (file) => {
      const result = runValidator([file]);
      expect(result.status).toBe(1);
      expect(result.stderr).toContain('placeholder');
    });
  });

  it('rejects a body with an unexpected section heading', () => {
    const body = `## Summary\n\nHello.\n\n## Random\n\nOops.\n\n## 摘要\n\n你好。\n\n## References\n\n- x by @a in https://github.com/samanhappy/mcphub/pull/1\n- Full changelog: https://github.com/samanhappy/mcphub/compare/v1.0.0...v1.0.1\n`;
    withTempFile(body, (file) => {
      const result = runValidator([file]);
      expect(result.status).toBe(1);
      expect(result.stderr).toContain('Unexpected section');
    });
  });

  it('accepts the shipped template as a valid example', () => {
    const template = fs.readFileSync(path.join(projectRoot, '.github', 'release-notes-template.md'), 'utf8');
    withTempFile(template, (file) => {
      const result = runValidator([file]);
      expect(result.status).toBe(0);
    });
  });

  it('exits 2 for a missing file', () => {
    const result = runValidator(['/nonexistent/notes.md']);
    expect(result.status).toBe(2);
  });
});
