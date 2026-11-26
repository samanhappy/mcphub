import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

const queuePath = '.agents/state/github-queue.json';
const defaultRepository = 'samanhappy/mcphub';
const idleThreshold = 14 * 24 * 60 * 60 * 1000;
const issueFields = 'number,title,state,labels,assignees,createdAt,updatedAt';
const prFields =
  'number,title,state,labels,isDraft,headRefOid,baseRefOid,reviewDecision,closingIssuesReferences,createdAt,updatedAt';

function readQueue(repository) {
  let raw;
  try {
    raw = readFileSync(queuePath, 'utf8');
  } catch (error) {
    if (error.code === 'ENOENT') return { status: 'missing', maxConcurrentRuns: 2, tasks: {} };
    throw error;
  }

  const reservations = new Map();
  const reserve = (key, owner) => {
    if (reservations.has(key) && reservations.get(key) !== owner) {
      throw new Error(`Conflicting queue reservation for ${key}`);
    }
    reservations.set(key, owner);
  };
  const isNumber = (number) => Number.isSafeInteger(number) && number > 0;

  try {
    const state = JSON.parse(raw);
    if (
      state?.version !== 1 ||
      state.repository !== repository ||
      !isNumber(state.max_concurrent_runs) ||
      !state.tasks ||
      typeof state.tasks !== 'object' ||
      Array.isArray(state.tasks) ||
      (state.last_synced_at != null && !Number.isFinite(Date.parse(state.last_synced_at)))
    ) {
      throw new Error('Invalid queue header or repository mismatch');
    }

    for (const [key, entry] of Object.entries(state.tasks)) {
      const { type, number } = entry?.task ?? {};
      const { issues, pull_requests: prs } = entry?.related ?? {};
      if (
        !['issue', 'pr'].includes(type) ||
        !isNumber(number) ||
        key !== `${type}#${number}` ||
        !['running', 'waiting'].includes(entry.status) ||
        !Array.isArray(issues) ||
        !Array.isArray(prs) ||
        ![...issues, ...prs].every(isNumber) ||
        (entry.pull_request != null && !isNumber(entry.pull_request))
      ) {
        throw new Error(`Invalid queue entry ${key}`);
      }
      reserve(key, key);
      issues.forEach((issue) => reserve(`issue#${issue}`, key));
      prs.forEach((pr) => reserve(`pr#${pr}`, key));
      if (entry.pull_request != null) reserve(`pr#${entry.pull_request}`, key);
    }
    return {
      status: 'valid',
      maxConcurrentRuns: state.max_concurrent_runs,
      lastSyncedAt: state.last_synced_at,
      tasks: state.tasks,
      reservations,
    };
  } catch (error) {
    return { status: 'invalid', error: error.message, tasks: {} };
  }
}

function listOpen(type, fields, repository) {
  for (let limit = 100; ; limit *= 2) {
    const items = gh(
      type,
      'list',
      '--repo',
      repository,
      '--state',
      'open',
      '--limit',
      String(limit),
      '--json',
      fields,
    );
    if (items.length < limit) return items;
  }
}

function gh(...args) {
  return JSON.parse(
    execFileSync('gh', args, { encoding: 'utf8', maxBuffer: 32 * 1024 * 1024, timeout: 30000 }),
  );
}

function activity(type, item, repository, now) {
  if (!item.labels.some((label) => ['user:feedback', 'user:verification'].includes(label))) {
    return null;
  }
  const fields = type === 'pr' ? 'comments,reviews' : 'comments';
  const { comments, reviews = [] } = gh(
    type,
    'view',
    String(item.number),
    '--repo',
    repository,
    '--json',
    fields,
  );
  const timestamps = [
    item.createdAt,
    ...comments.map((comment) => comment.createdAt),
    ...reviews.map((review) => review.submittedAt),
  ];
  if (type === 'pr') {
    const inline = gh(
      'api',
      `repos/${repository}/pulls/${item.number}/comments?sort=created&direction=desc&per_page=1`,
    );
    timestamps.push(inline[0]?.created_at);
  }
  const lastActivity = Math.max(...timestamps.filter(Boolean).map(Date.parse));
  return {
    lastActivityAt: new Date(lastActivity).toISOString(),
    stale: now - lastActivity > idleThreshold,
  };
}

function inspect(repository) {
  const now = Date.now();
  const queue = readQueue(repository);
  const candidates = [];
  const open = new Map();
  for (const [type, fields] of [
    ['issue', issueFields],
    ['pr', prFields],
  ]) {
    for (const entry of listOpen(type, fields, repository)) {
      const key = `${type}#${entry.number}`;
      const item = { ...entry, labels: entry.labels.map(({ name }) => name) };
      const trackedBy = queue.reservations?.get(key) ?? null;
      open.set(key, {
        ...item,
        trackedBy,
        updatedSinceSync:
          !queue.lastSyncedAt || Date.parse(item.updatedAt) > Date.parse(queue.lastSyncedAt),
        activity: activity(type, item, repository, now),
      });

      if (!item.labels.includes('agent:pending')) continue;
      const excludedBy = [];
      if (queue.status === 'invalid') excludedBy.push('invalid-queue');
      if (trackedBy) excludedBy.push('tracked');
      if (item.labels.includes('ready-for-human')) excludedBy.push('human-only');
      if (item.assignees?.length) excludedBy.push('assigned');
      if (item.isDraft) excludedBy.push('draft');
      candidates.push({ key, excludedBy });
    }
  }

  const tracked = Object.entries(queue.tasks).map(([key, entry]) => {
    const prNumber = entry.pull_request ?? (entry.task.type === 'pr' ? entry.task.number : null);
    const primary =
      open.get(key) ??
      gh(
        entry.task.type,
        'view',
        String(entry.task.number),
        '--repo',
        repository,
        '--json',
        entry.task.type === 'pr' ? 'state,headRefOid' : 'state',
      );
    const pr =
      prNumber == null
        ? null
        : entry.task.type === 'pr' && entry.task.number === prNumber
          ? primary
          : (open.get(`pr#${prNumber}`) ??
            gh('pr', 'view', String(prNumber), '--repo', repository, '--json', 'state,headRefOid'));
    const previousHead = entry.mode === 'pr_review' ? entry.reviewed_head_sha : entry.head_sha;
    return {
      key,
      status: entry.status,
      runtimeRef: entry.runtime_ref ?? null,
      state: primary.state,
      prNumber,
      prState: pr?.state ?? null,
      headSha: pr?.headRefOid ?? null,
      previousHead: previousHead ?? null,
      headChanged: pr?.headRefOid && previousHead ? pr.headRefOid !== previousHead : null,
    };
  });
  const running = tracked.filter(({ status }) => status === 'running').length;
  return {
    repository,
    checkedAt: new Date(now).toISOString(),
    queue: {
      status: queue.status,
      error: queue.error ?? null,
      lastSyncedAt: queue.lastSyncedAt ?? null,
      maxConcurrentRuns: queue.maxConcurrentRuns ?? null,
      running: queue.status === 'invalid' ? null : running,
      availableSlots:
        queue.status === 'invalid' ? null : Math.max(0, queue.maxConcurrentRuns - running),
    },
    open: Object.fromEntries(open),
    candidates,
    tracked,
  };
}

try {
  const [repository = defaultRepository, ...unexpected] = process.argv.slice(2);
  if (unexpected.length || !/^[\w.-]+\/[\w.-]+$/.test(repository)) {
    throw new Error('Usage: node scripts/inspect-github-queue.js [owner/repository]');
  }
  console.log(JSON.stringify(inspect(repository), null, 2));
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}
