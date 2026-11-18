jest.mock('openid-client', () => ({}));

import { createHash } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import express from 'express';
import request from 'supertest';
import { sseUserContextMiddleware } from '../../src/middlewares/userContext.js';
import { closeModernMcpHandler, handleMcpPostRequest } from '../../src/services/sseService.js';
import {
  deleteHostedSkill,
  importHostedSkill,
  listHostedSkills,
  publishHostedSkill,
  uploadSkillDirectory,
} from '../../src/controllers/hostedSkillController.js';
import { requireAdminMiddleware } from '../../src/utils/requireAdmin.js';
import { JsonFileDaoFactory, setDaoFactory } from '../../src/dao/DaoFactory.js';

const app = express();
let server: ReturnType<typeof app.listen>;
app.use(express.json());
app.post('/mcp/:group?', sseUserContextMiddleware, handleMcpPostRequest);
app.use('/api', (req, _res, next) => {
  Object.assign(req, { user: { isAdmin: req.get('X-Test-Admin') === 'yes' } });
  next();
});
app.get('/api/skills', requireAdminMiddleware, listHostedSkills);
app.post('/api/skills', requireAdminMiddleware, uploadSkillDirectory, importHostedSkill);
app.put('/api/skills/:id/content', requireAdminMiddleware, uploadSkillDirectory, importHostedSkill);
app.put('/api/skills/:id', requireAdminMiddleware, publishHostedSkill);
app.delete('/api/skills/:id', requireAdminMiddleware, deleteHostedSkill);

const team = '11111111-1111-4111-8111-111111111111';
const other = '22222222-2222-4222-8222-222222222222';
const publicToken = 'public-key';
const memberToken = 'team-member-key';

const rpc = (
  method: string,
  params: Record<string, unknown> = {},
  endpoint = '/mcp',
  token = publicToken,
) =>
  request(server)
    .post(endpoint)
    .set('Authorization', `Bearer ${token}`)
    .set('Accept', 'application/json, text/event-stream')
    .set('MCP-Protocol-Version', '2026-07-28')
    .set('Mcp-Method', method)
    .set(method === 'resources/read' ? { 'Mcp-Name': String(params.uri) } : {})
    .send({
      jsonrpc: '2.0',
      id: 1,
      method,
      params: {
        ...params,
        _meta: {
          'io.modelcontextprotocol/protocolVersion': '2026-07-28',
          'io.modelcontextprotocol/clientInfo': { name: 'skills-test', version: '1' },
          'io.modelcontextprotocol/clientCapabilities': {},
        },
      },
    });

const manifest = Buffer.from(
  '\uFEFF---\r\nname: team-guide\r\ndescription: Team workflow\r\nmetadata:\r\n  flag: yes\r\n---\r\n[Guide](references/guide.txt)\r\n',
);
const attachment = Buffer.from([0xff, 0x00, 0x80]);
const directoryUpload = (body: Array<[string, Buffer]>) =>
  Buffer.from(
    JSON.stringify({
      directory: 'team-guide',
      files: body.map(([path, bytes]) => ({ path, base64: bytes.toString('base64') })),
    }),
  );
const importDirectory = (files: Array<[string, Buffer]>, id?: string) =>
  (id ? request(server).put(`/api/skills/${id}/content`) : request(server).post('/api/skills'))
    .set('X-Test-Admin', 'yes')
    .attach('directory', directoryUpload(files), 'skill.json');

let directory: string;
const previousPath = process.env.MCPHUB_SETTING_PATH;
beforeAll(async () => {
  directory = fs.mkdtempSync(path.join(os.tmpdir(), 'mcphub-skills-'));
  process.env.MCPHUB_SETTING_PATH = path.join(directory, 'settings.json');
  fs.writeFileSync(
    process.env.MCPHUB_SETTING_PATH,
    JSON.stringify({
      mcpServers: {},
      resources: [
        {
          id: 'existing-resource',
          uri: 'skill://mcphub/existing',
          name: 'Existing resource',
          content: 'Existing resource content',
        },
      ],
      users: [{ username: 'member', password: 'unused' }],
      groups: [
        {
          id: team,
          name: 'team',
          owner: 'admin',
          visibility: 'group',
          sharedWithUsers: ['member'],
          servers: [],
        },
        { id: other, name: 'other', owner: 'admin', visibility: 'public', servers: [] },
      ],
      bearerKeys: [
        {
          id: 'public',
          name: 'public',
          token: publicToken,
          kind: 'system',
          enabled: true,
          accessType: 'all',
        },
        {
          id: 'member',
          name: 'member',
          token: memberToken,
          kind: 'user',
          owner: 'member',
          enabled: true,
          accessType: 'groups',
          allowedGroups: [team],
        },
      ],
      systemConfig: { routing: { enableBearerAuth: true }, oauthServer: { enabled: false } },
    }),
  );
  JsonFileDaoFactory.getInstance().resetInstances();
  setDaoFactory(JsonFileDaoFactory.getInstance());
  server = await new Promise((resolve, reject) => {
    const listener = app.listen(0, '127.0.0.1', () => resolve(listener));
    listener.once('error', reject);
  });
});
afterAll(async () => {
  await closeModernMcpHandler();
  if (server) await new Promise<void>((resolve) => server.close(() => resolve()));
  fs.rmSync(directory, { recursive: true, force: true });
  if (previousPath === undefined) delete process.env.MCPHUB_SETTING_PATH;
  else process.env.MCPHUB_SETTING_PATH = previousPath;
});
afterEach(() => jest.restoreAllMocks());

it('advertises the extension, without the optional directory method', async () => {
  const discovery = await rpc('server/discover').expect(200);
  expect(discovery.body).toHaveProperty('result.capabilities');
  expect(discovery.body.result.capabilities.extensions).toHaveProperty(
    ['io.modelcontextprotocol/skills'],
    {},
  );
  expect(discovery.body.result.capabilities).toHaveProperty('resources');
  const listing = await rpc('skills/list').expect(200);
  expect(listing.body.result).toMatchObject({ skills: [], ttlMs: 0, cacheScope: 'private' });
  const existing = await rpc('resources/read', { uri: 'skill://mcphub/existing' });
  expect(existing.body.result.contents[0].text).toBe('Existing resource content');
  const legacy = await request(server)
    .post('/mcp')
    .set('Authorization', `Bearer ${publicToken}`)
    .set('Accept', 'application/json, text/event-stream')
    .send({
      jsonrpc: '2.0',
      id: 1,
      method: 'initialize',
      params: {
        protocolVersion: '2025-11-25',
        capabilities: {},
        clientInfo: { name: 'legacy', version: '1' },
      },
    })
    .expect(200);
  const oldResult = legacy.body.result ?? JSON.parse(legacy.text.split('\ndata: ')[1]).result;
  expect(oldResult.capabilities.tools).toBeDefined();
  expect(oldResult.capabilities.extensions ?? {}).not.toHaveProperty([
    'io.modelcontextprotocol/skills',
  ]);
});

it('imports directories, restricts all reads by publication scope, and replaces and removes snapshots', async () => {
  await request(server).get('/api/skills').expect(403);
  await request(server)
    .post('/api/skills')
    .attach('directory', directoryUpload([['SKILL.md', manifest]]), 'skill.json')
    .expect(403);
  await importDirectory([
    ['SKILL.md', manifest],
    ['../outside.txt', Buffer.from('x')],
  ]).expect(400);
  const fixtures: Array<[string, Buffer]> = [
    ['SKILL.md', manifest],
    ['references/guide.txt', attachment],
  ];
  const created = (await importDirectory(fixtures).expect(201)).body.data;
  const duplicate = (await importDirectory(fixtures).expect(201)).body.data;
  expect(duplicate.files[0].uri).not.toBe(created.files[0].uri);
  expect(created).toMatchObject({ enabled: false, global: false, groupIds: [] });
  const uri = created.files.find((file: { path: string }) => file.path === 'SKILL.md').uri;
  const fileUri = created.files.find(
    (file: { path: string }) => file.path === 'references/guide.txt',
  ).uri;
  const groupRoute = `/mcp/${team}`;
  const groupCall = (method: string, params?: Record<string, unknown>) =>
    rpc(method, params, groupRoute, memberToken);
  expect((await groupCall('skills/list')).body.result.skills).toEqual([]);
  await request(server)
    .put(`/api/skills/${created.id}`)
    .set('X-Test-Admin', 'yes')
    .send({ enabled: true, global: false, groupIds: [team] })
    .expect(200);

  const listed = (await groupCall('skills/list')).body.result.skills;
  expect(listed).toHaveLength(1);
  const got = (await groupCall('skills/get', { uri })).body.result;
  expect(got).toMatchObject({
    resultType: 'complete',
    skill: listed[0],
    ttlMs: 0,
    cacheScope: 'private',
  });
  expect(got.skill.frontmatter.metadata).toEqual({ flag: 'yes' });
  const guide = (await groupCall('resources/read', { uri: fileUri })).body.result.contents[0];
  const servedManifest = (await groupCall('resources/read', { uri })).body.result.contents[0];
  for (const [resource, bytes] of [
    [guide, attachment],
    [servedManifest, manifest],
  ] as const) {
    const metadata = got.skill.resources.find((file: { uri: string }) => file.uri === resource.uri);
    expect(metadata).toMatchObject({
      size: bytes.length,
      digest: `sha256:${createHash('sha256').update(bytes).digest('hex')}`,
    });
  }
  expect(guide.blob).toBe(attachment.toString('base64'));
  expect(servedManifest.text).toBe(manifest.toString('utf8'));

  for (const endpoint of ['/mcp', '/mcp/other', '/mcp/team']) {
    expect((await rpc('skills/list', {}, endpoint)).body.result.skills).toEqual([]);
    expect((await rpc('skills/get', { uri }, endpoint)).body.error.code).toBe(-32602);
    expect((await rpc('resources/read', { uri: fileUri }, endpoint)).body.error.code).toBe(-32602);
  }
  await rpc('skills/list', {}, '/mcp/other', memberToken).expect(401);
  expect((await rpc('skills/list', {}, '/mcp/team', memberToken)).body.result.skills).toHaveLength(
    1,
  );

  const newBytes = Buffer.from('updated guide');
  const updated = (
    await importDirectory(
      [
        ['SKILL.md', manifest],
        ['references/guide.txt', newBytes],
      ],
      created.id,
    ).expect(200)
  ).body.data;
  expect(updated).toMatchObject({ id: created.id, enabled: true, groupIds: [team] });
  expect(updated.version).not.toBe(created.version);
  expect((await groupCall('resources/read', { uri: fileUri })).body.result.contents[0].text).toBe(
    newBytes.toString(),
  );
  await request(server)
    .put(`/api/skills/${created.id}`)
    .set('X-Test-Admin', 'yes')
    .send({ enabled: false, global: true, groupIds: [team] })
    .expect(200);
  expect((await groupCall('resources/read', { uri: fileUri })).body.error.code).toBe(-32602);
  await request(server)
    .put(`/api/skills/${created.id}`)
    .set('X-Test-Admin', 'yes')
    .send({ enabled: true, global: true, groupIds: [] })
    .expect(200);
  expect((await rpc('skills/list')).body.result.skills).toHaveLength(1);
  await request(server).delete(`/api/skills/${created.id}`).set('X-Test-Admin', 'yes').expect(200);
  expect((await rpc('skills/get', { uri })).body.error.code).toBe(-32602);
  expect((await rpc('resources/read', { uri: fileUri })).body.error.code).toBe(-32602);
  const management = await request(server)
    .get('/api/skills')
    .set('X-Test-Admin', 'yes')
    .expect(200);
  expect(management.body.data.map(({ id }: { id: string }) => id)).toEqual([duplicate.id]);
});

it.each(['100644', '120000'])(
  'validates GitHub tree entries with mode %s before publishing',
  async (mode) => {
    const url = 'https://github.com/test/repo/tree/main/team-guide';
    const commit = 'a'.repeat(40);
    const root = 'b'.repeat(40);
    const tree = 'c'.repeat(40);
    const gitBlob = (path: string, bytes: Buffer, mode: string) => ({
      path,
      mode,
      type: 'blob',
      size: bytes.length,
      sha: createHash('sha1').update(`blob ${bytes.length}\0`).update(bytes).digest('hex'),
    });
    const fakeFetch = jest.spyOn(global, 'fetch').mockImplementation(async (input) => {
      const url = String(input);
      if (url.endsWith('/commits/main'))
        return Response.json({ sha: commit, commit: { tree: { sha: root } } });
      if (url.endsWith(`/git/trees/${root}`))
        return Response.json({ tree: [{ type: 'tree', path: 'team-guide', sha: tree }] });
      if (url.endsWith(`/git/trees/${tree}?recursive=1`)) {
        return Response.json({
          tree: [
            gitBlob('SKILL.md', manifest, '100644'),
            gitBlob('references/guide.txt', attachment, mode),
          ],
        });
      }
      if (url === `https://raw.githubusercontent.com/test/repo/${commit}/team-guide/SKILL.md`)
        return new Response(new Uint8Array(manifest));
      if (
        url ===
        `https://raw.githubusercontent.com/test/repo/${commit}/team-guide/references/guide.txt`
      )
        return new Response(new Uint8Array(attachment));
      throw new Error('Unexpected GitHub request');
    });
    const response = await request(server)
      .post('/api/skills')
      .set('X-Test-Admin', 'yes')
      .send({ url })
      .expect(mode === '100644' ? 201 : 400);
    if (mode === '100644') {
      expect(response.body.data.source).toEqual({ type: 'github', url, commit });
      expect(response.body.data.files.map((file: { path: string }) => file.path).sort()).toEqual([
        'SKILL.md',
        'references/guide.txt',
      ]);
    } else {
      expect(fakeFetch).toHaveBeenCalledTimes(3);
    }
  },
);
