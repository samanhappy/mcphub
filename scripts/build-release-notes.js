import { execFileSync } from 'child_process';

// Generate the deterministic parts of a bilingual release-notes draft for a
// GitHub release: previous tag, merged PRs in range, new contributors, and the
// pre-formatted References / New Contributors blocks. The creative parts
// (Summary, 摘要, and classifying PRs into Features/Fixes) are left to the
// agent in the conversation.
//
// Usage: node scripts/build-release-notes.js [tag]
//   (no tag -> latest release)
//
// Prints a draft skeleton to stdout. Never writes files.

const REPO = 'samanhappy/mcphub';
const BOT_RE = /dependabot\[bot\]|github-actions\[bot\]|\[bot\]$|^copilot$/i;
const NEW_CONTRIBUTOR_RE = /^-\s*@(\S+)\s+made their first contribution in #(\d+)/;
const PR_LIMIT = 300;

function run(cmd, args, { allowFail = false } = {}) {
  try {
    return execFileSync(cmd, args, { encoding: 'utf8', maxBuffer: 16 * 1024 * 1024 }).trim();
  } catch (err) {
    if (allowFail) return '';
    process.stderr.write(`Command failed: ${cmd} ${args.join(' ')}\n${err.stderr || err.message}\n`);
    process.exit(1);
  }
}

function runQuiet(cmd, args) {
  try {
    return execFileSync(cmd, args, { encoding: 'utf8', maxBuffer: 16 * 1024 * 1024, stdio: ['ignore', 'pipe', 'ignore'] }).trim();
  } catch {
    return '';
  }
}

function gh(args, opts) {
  return run('gh', args, opts);
}

function latestTag() {
  return gh(['release', 'list', '--limit', '1', '--json', 'tagName', '--jq', '.[0].tagName']);
}

function releaseBody(tag) {
  return gh(['release', 'view', tag, '--json', 'body', '--jq', '.body'], { allowFail: true });
}

function releasePublishedAt(tag) {
  const out = gh(['release', 'view', tag, '--json', 'publishedAt', '--jq', '.publishedAt'], { allowFail: true });
  return out ? new Date(out).getTime() : null;
}

// Previous tag: prefer the compare line in the existing body, fall back to git.
function resolvePrevTag(tag, body) {
  const m = body.match(/compare\/([^\s]+)\.\.\.([^\s]+)/);
  if (m) return m[1];
  return runQuiet('git', ['describe', '--tags', '--abbrev=0', `${tag}^`]) || null;
}

function extractSection(markdown, heading) {
  const lines = markdown.replace(/^\uFEFF/, '').replace(/\r\n?/g, '\n').split('\n');
  let out = [];
  let active = false;
  for (const line of lines) {
    const h = line.match(/^#{2,3}\s+(.+?)\s*#*\s*$/);
    if (h) {
      if (active) break;
      active = h[1].trim() === heading;
      continue;
    }
    if (active) out.push(line);
  }
  return out.filter((line) => line.trim()).join('\n');
}

// Reuse the existing body's New Contributors section when present (GitHub's
// auto-generated notes already compute it); avoids per-author N+1 queries.
function parseNewContributors(body) {
  const content = extractSection(body, 'New Contributors');
  const out = [];
  for (const line of content.split('\n')) {
    const m = line.trim().match(NEW_CONTRIBUTOR_RE);
    if (m) out.push({ login: m[1], number: m[2] });
  }
  return out;
}

// Fallback detection: an author is new if they had no merged PR before prev.
function detectNewContributors(prs, prevTag) {
  const prevAt = prevTag ? releasePublishedAt(prevTag) : null;
  const authors = [...new Set(prs.map((p) => p.author && p.author.login))].filter(
    (login) => login && !BOT_RE.test(login),
  );
  const out = [];
  for (const login of authors) {
    if (prevAt === null) {
      out.push({ login, number: null });
      continue;
    }
    const prevDate = new Date(prevAt).toISOString().slice(0, 10);
    const hit = gh(
      ['pr', 'list', '--state', 'merged', '--search', `author:${login} merged:<=${prevDate}`, '--limit', '1', '--json', 'number'],
      { allowFail: true },
    );
    if (!hit || hit.trim() === '[]') {
      const first = prs.filter((p) => p.author && p.author.login === login).sort((a, b) => new Date(a.mergedAt) - new Date(b.mergedAt))[0];
      out.push({ login, number: first ? first.number : null });
    }
  }
  return out;
}

function fetchMergedPRsInRange(prevTag, tag) {
  const prevAt = prevTag ? releasePublishedAt(prevTag) : null;
  const tagAt = releasePublishedAt(tag);
  const out = JSON.parse(gh(['pr', 'list', '--state', 'merged', '--limit', String(PR_LIMIT), '--json', 'number,title,author,url,mergedAt']));
  const filtered = out.filter((p) => {
    const at = new Date(p.mergedAt).getTime();
    if (prevAt !== null && at <= prevAt) return false;
    if (tagAt !== null && at > tagAt) return false;
    return true;
  });
  if (filtered.length >= PR_LIMIT) {
    process.stderr.write(`WARNING: range may exceed ${PR_LIMIT} merged PRs; results are truncated.\n`);
  }
  return filtered;
}

const tag = process.argv[2] || latestTag();
const body = releaseBody(tag) || '';
const prevTag = resolvePrevTag(tag, body);
const prs = fetchMergedPRsInRange(prevTag, tag);
const reused = parseNewContributors(body);
const newContributors = reused.length > 0 ? reused : detectNewContributors(prs, prevTag);
const compare = `https://github.com/${REPO}/compare/${prevTag || '?prev'}...${tag}`;

const lines = [];
lines.push(`# Release notes draft: ${tag}`);
lines.push(`# previous tag: ${prevTag || '(first release — no previous tag)'}`);
lines.push(`# compare: ${compare}`);
lines.push(`# merged PRs in range: ${prs.length}`);
lines.push('# classify each PR below into Summary / Features / Fixes and write the bilingual sections.');
lines.push('');

lines.push('## Summary');
lines.push('');
lines.push('<<FILL: one English paragraph on why this release matters>>');
lines.push('');

lines.push('## Features');
lines.push('');
lines.push('<<FILL: user-facing additions (omit if none)>>');
lines.push('');

lines.push('## Fixes');
lines.push('');
lines.push('<<FILL: bug fixes, reliability, dependency bumps (omit if none)>>');
lines.push('');

lines.push('## 摘要');
lines.push('');
lines.push('<<FILL: 用中文概括这个版本为什么值得升级>>');
lines.push('');

lines.push('## 功能');
lines.push('');
lines.push('<<FILL: 面向用户的功能或体验改进 (omit if none)>>');
lines.push('');

lines.push('## 修复');
lines.push('');
lines.push('<<FILL: 缺陷修复、稳定性改进或依赖更新 (omit if none)>>');
lines.push('');

if (newContributors.length > 0) {
  lines.push('## New Contributors');
  lines.push('');
  for (const nc of newContributors) {
    lines.push(`- @${nc.login} made their first contribution in #${nc.number}`);
  }
  lines.push('');
}

lines.push('## References');
lines.push('');
for (const p of prs) {
  lines.push(`- ${p.title} by @${p.author.login} in ${p.url}`);
}
lines.push(`- Full changelog: ${compare}`);

process.stdout.write(lines.join('\n') + '\n');
