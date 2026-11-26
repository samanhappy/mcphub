import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

const script = path.resolve(__dirname, '../../scripts/inspect-github-queue.js');
const repository = 'samanhappy/mcphub';
const past = '2020-01-01T00:00:00Z';
const recent = new Date().toISOString();
const state = {
  version: 1,
  repository,
  max_concurrent_runs: 2,
  last_synced_at: recent,
  tasks: {
    'issue#1': {
      task: { type: 'issue', number: 1 },
      related: { issues: [], pull_requests: [5] },
      status: 'waiting',
      mode: 'implementation',
      pull_request: 5,
      head_sha: 'merged-head',
    },
    'pr#2': {
      task: { type: 'pr', number: 2 },
      related: { issues: [6], pull_requests: [] },
      status: 'running',
      mode: 'pr_review',
      runtime_ref: 'worker-2',
      reviewed_head_sha: 'previous-head',
    },
  },
};

function runInspection(queue: string | null) {
  const root = mkdtempSync(path.join(tmpdir(), 'inspect-github-queue-'));
  const queuePath = path.join(root, '.agents/state/github-queue.json');
  try {
    if (queue !== null) {
      mkdirSync(path.dirname(queuePath), { recursive: true });
      writeFileSync(queuePath, queue);
    }
    writeFileSync(
      path.join(root, 'gh'),
      `#!/usr/bin/env node
const [type, operation, number] = process.argv.slice(2);
const args = process.argv.slice(2);
const item = (number, label = 'agent:pending', extra = {}) => ({
  number, title: 'Fixture', state: 'OPEN', labels: [{ name: label }], assignees: [],
  createdAt: '${past}', updatedAt: '${recent}', ...extra,
});
let result;
if (type === 'issue' && operation === 'list') {
  const full = [
    item(1),
    item(3, 'user:feedback'),
    item(4, 'agent:pending', { updatedAt: '${past}' }),
    item(6),
    item(7, 'agent:pending', { assignees: [{ login: 'contributor' }] }),
    ...Array.from({ length: 96 }, (_, n) => item(n + 10, 'owner:decision')),
  ];
  result = full.slice(0, Number(args[args.indexOf('--limit') + 1]));
} else if (type === 'pr' && operation === 'list') {
  result = [
    item(2, 'agent:pending', { headRefOid: 'new-head' }),
    item(8, 'agent:pending', { isDraft: true }),
    item(9, 'user:verification'),
  ];
} else if (type === 'issue' && operation === 'view' && number === '3') {
  result = { comments: [{ createdAt: '${past}' }] };
} else if (type === 'pr' && operation === 'view' && number === '9') {
  result = { comments: [], reviews: [{ submittedAt: '${past}' }] };
} else if (type === 'pr' && operation === 'view' && number === '5') {
  result = { state: 'MERGED', headRefOid: 'merged-head' };
} else if (type === 'api' && operation.endsWith('/pulls/9/comments?sort=created&direction=desc&per_page=1')) {
  result = [{ created_at: '${recent}' }];
} else {
  throw Error('Unexpected GitHub command: ' + args.join(' '));
}
console.log(JSON.stringify(result));
`,
      { mode: 0o755 },
    );
    const result = spawnSync(process.execPath, [script], {
      cwd: root,
      env: { ...process.env, PATH: `${root}${path.delimiter}${process.env.PATH}` },
      encoding: 'utf8',
    });
    expect(result.stderr).toBe('');
    expect(result.status).toBe(0);
    if (queue !== null) {
      expect(readFileSync(queuePath, 'utf8')).toBe(queue);
    } else {
      expect(() => readFileSync(queuePath)).toThrow('ENOENT');
    }
    return JSON.parse(result.stdout);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

describe('inspect-github-queue', () => {
  it('keeps older pending candidates, detects quiet time and reconciles tracked PR heads', () => {
    const report = runInspection(JSON.stringify(state));
    expect(Object.keys(report.open)).toHaveLength(104);
    expect(report.queue).toMatchObject({ status: 'valid', running: 1, availableSlots: 1 });
    expect(report.candidates).toEqual([
      { key: 'issue#1', excludedBy: ['tracked'] },
      { key: 'issue#4', excludedBy: [] },
      { key: 'issue#6', excludedBy: ['tracked'] },
      { key: 'issue#7', excludedBy: ['assigned'] },
      { key: 'pr#2', excludedBy: ['tracked'] },
      { key: 'pr#8', excludedBy: ['draft'] },
    ]);
    expect(report.open['issue#4'].updatedSinceSync).toBe(false);
    expect(report.open['issue#3'].activity.stale).toBe(true);
    expect(report.open['pr#9'].activity.stale).toBe(false);
    expect(report.tracked).toMatchObject([
      { key: 'issue#1', prState: 'MERGED', headChanged: false },
      { key: 'pr#2', runtimeRef: 'worker-2', headChanged: true },
    ]);
  });

  it('distinguishes missing state from conflicting reservations without writing state', () => {
    const missing = runInspection(null);
    expect(missing.queue).toMatchObject({ status: 'missing', running: 0, availableSlots: 2 });

    const conflicting = structuredClone(state);
    conflicting.tasks['pr#2'].related.issues.push(1);
    const invalid = runInspection(JSON.stringify(conflicting));
    expect(invalid.queue).toMatchObject({ status: 'invalid', running: null, availableSlots: null });
    expect(
      invalid.candidates.every(({ excludedBy }: { excludedBy: string[] }) =>
        excludedBy.includes('invalid-queue'),
      ),
    ).toBe(true);
  });
});
