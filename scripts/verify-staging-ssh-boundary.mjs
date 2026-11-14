#!/usr/bin/env node
/**
 * Real-SSH acceptance check for the file staging boundary (#1056).
 *
 * Spawns the pinned @fangjunjie/ssh-mcp-server as an MCP stdio child with a
 * per-principal cwd, then proves that the server itself rejects every local
 * path outside that cwd (upload, download, and the hub ledger). This is the
 * behavior the shared-staging trust model relies on.
 *
 * Usage:
 *   STAGING_CHECK_SSH_HOST=127.0.0.1 \
 *   STAGING_CHECK_SSH_PORT=22222 \
 *   STAGING_CHECK_SSH_USER=staging \
 *   STAGING_CHECK_SSH_KEY=/path/to/key \
 *   STAGING_CHECK_ROOT=/tmp/staging-check-root \
 *   STAGING_CHECK_SERVER_ENTRY=/path/to/ssh-mcp-server/build/index.js \
 *   node scripts/verify-staging-ssh-boundary.mjs
 *
 * STAGING_CHECK_SERVER_ENTRY is optional: when omitted the script resolves
 * @fangjunjie/ssh-mcp-server@1.11.0 through npx from the current directory.
 * Exit code 0 means every check passed.
 */
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const HOST = process.env.STAGING_CHECK_SSH_HOST;
const PORT = process.env.STAGING_CHECK_SSH_PORT ?? '22';
const USER = process.env.STAGING_CHECK_SSH_USER;
const KEY = process.env.STAGING_CHECK_SSH_KEY;
const ROOT = process.env.STAGING_CHECK_ROOT;
if (!HOST || !USER || !KEY || !ROOT) {
  console.error('Missing STAGING_CHECK_SSH_HOST/USER/KEY/ROOT');
  process.exit(2);
}
fs.mkdirSync(ROOT, { recursive: true });
const OUTSIDE = path.join(path.dirname(ROOT), `${path.basename(ROOT)}-outside.txt`);
fs.writeFileSync(OUTSIDE, 'outside\n');
const INSIDE = path.join(ROOT, 'allowed.txt');
fs.writeFileSync(INSIDE, 'inside-root\n');

const entry = process.env.STAGING_CHECK_SERVER_ENTRY;
const command = entry ? process.execPath : 'npx';
const args = entry
  ? [entry]
  : ['-y', '@fangjunjie/ssh-mcp-server@1.11.0'];

const child = spawn(
  command,
  [...args, '--host', HOST, '--port', PORT, '--username', USER, '--privateKey', KEY],
  { cwd: ROOT, stdio: ['pipe', 'pipe', 'pipe'] },
);

let buffer = '';
const pending = new Map();
child.stdout.on('data', (chunk) => {
  buffer += chunk.toString();
  let index;
  while ((index = buffer.indexOf('\n')) >= 0) {
    const line = buffer.slice(0, index).trim();
    buffer = buffer.slice(index + 1);
    if (!line) continue;
    try {
      const message = JSON.parse(line);
      if (message.id && pending.has(message.id)) {
        pending.get(message.id)(message);
        pending.delete(message.id);
      }
    } catch {
      // Ignore non-JSON stdout lines.
    }
  }
});
const stderr = [];
child.stderr.on('data', (chunk) => stderr.push(chunk.toString()));

const request = (id, method, params) =>
  new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`timeout ${method}`)), 30000);
    pending.set(id, (message) => {
      clearTimeout(timer);
      resolve(message);
    });
    child.stdin.write(JSON.stringify({ jsonrpc: '2.0', id, method, params }) + '\n');
  });
const notify = (method) =>
  child.stdin.write(JSON.stringify({ jsonrpc: '2.0', method }) + '\n');
const text = (result) => result?.content?.map((part) => part.text).join('\n') ?? '';

const main = async () => {
  await request(1, 'initialize', {
    protocolVersion: '2024-11-05',
    capabilities: {},
    clientInfo: { name: 'staging-boundary-check', version: '1.0.0' },
  });
  notify('notifications/initialized');
  const listed = await request(2, 'tools/list', {});
  const tools = listed.result.tools.map((tool) => tool.name);
  const byName = (needle) => tools.find((name) => name.includes(needle));
  const results = { tools, checks: [] };
  const upload = byName('upload');
  const download = byName('download');
  const exec = byName('execute') ?? byName('exec') ?? byName('command');
  if (!upload || !download || !exec) throw new Error('expected upload/download/execute tools');

  const outsideUpload = await request(3, 'tools/call', {
    name: upload,
    arguments: { localPath: OUTSIDE, remotePath: '/tmp/staging-boundary-out.txt' },
  });
  results.checks.push({
    name: 'upload outside the per-principal root is denied',
    pass: outsideUpload.result?.isError === true,
    detail: text(outsideUpload.result).slice(0, 200),
  });

  const ledgerUpload = await request(4, 'tools/call', {
    name: upload,
    arguments: { localPath: path.join(path.dirname(ROOT), 'staging-state', 'refs.json'), remotePath: '/tmp/refs-leak.json' },
  });
  results.checks.push({
    name: 'upload of the hub ledger is denied',
    pass: ledgerUpload.result?.isError === true,
    detail: text(ledgerUpload.result).slice(0, 200),
  });

  const allowedUpload = await request(5, 'tools/call', {
    name: upload,
    arguments: { localPath: INSIDE, remotePath: '/tmp/staging-allowed.txt' },
  });
  results.checks.push({
    name: 'upload inside the per-principal root succeeds',
    pass: allowedUpload.result?.isError !== true,
    detail: text(allowedUpload.result).slice(0, 200),
  });

  const before = fs.readFileSync(OUTSIDE, 'utf8');
  const outsideDownload = await request(6, 'tools/call', {
    name: download,
    arguments: { remotePath: '/etc/hostname', localPath: OUTSIDE },
  });
  results.checks.push({
    name: 'download to a path outside the root is denied and does not overwrite it',
    pass: outsideDownload.result?.isError === true && fs.readFileSync(OUTSIDE, 'utf8') === before,
    detail: text(outsideDownload.result).slice(0, 200),
  });

  const remote = await request(7, 'tools/call', {
    name: exec,
    arguments: {
      cmdString:
        'ls /tmp/staging-boundary-out.txt /tmp/refs-leak.json 2>&1; cat /tmp/staging-allowed.txt',
    },
  });
  const output = text(remote.result);
  results.checks.push({
    name: 'denied uploads left no remote file and the allowed one arrived',
    pass:
      (output.match(/No such file or directory/g) ?? []).length >= 2 &&
      output.includes('inside-root'),
    detail: output.slice(0, 300),
  });

  results.pass = results.checks.every((check) => check.pass);
  console.log(JSON.stringify(results, null, 2));
  child.kill('SIGTERM');
  process.exit(results.pass ? 0 : 1);
};

main().catch((error) => {
  console.error('BOUNDARY_CHECK_ERROR', error.message, stderr.join('').slice(-1000));
  child.kill('SIGTERM');
  process.exit(2);
});
