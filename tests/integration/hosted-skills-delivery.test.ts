jest.mock('openid-client', () => ({}));

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import express from 'express';
import request from 'supertest';
import { sseUserContextMiddleware } from '../../src/middlewares/userContext.js';
import { closeModernMcpHandler, handleMcpPostRequest } from '../../src/services/sseService.js';
import {
  importHostedSkill,
  publishHostedSkill,
  uploadSkillDirectory,
} from '../../src/controllers/hostedSkillController.js';
import { createNewGroup, updateExistingGroup } from '../../src/controllers/groupController.js';
import { requireAdminMiddleware } from '../../src/utils/requireAdmin.js';
import {
  authenticatedRouteRateLimiter,
  mcpConnectionRateLimiter,
} from '../../src/utils/rateLimit.js';
import { JsonFileDaoFactory, setDaoFactory } from '../../src/dao/DaoFactory.js';
import { UserContextService } from '../../src/services/userContextService.js';

const app = express();
let server: ReturnType<typeof app.listen>;
app.use(express.json());
app.post('/mcp/:group(.*)?', mcpConnectionRateLimiter, sseUserContextMiddleware, handleMcpPostRequest);
app.use('/api', authenticatedRouteRateLimiter, (req, _res, next) => {
  const user = { username: 'admin', isAdmin: req.get('X-Test-Admin') === 'yes' };
  Object.assign(req, { user });
  UserContextService.getInstance().runWithContext(() => next(), user);
});
app.post('/api/skills', requireAdminMiddleware, uploadSkillDirectory, importHostedSkill);
app.put('/api/skills/:id', requireAdminMiddleware, publishHostedSkill);
app.post('/api/groups', createNewGroup);
app.put('/api/groups/:id', updateExistingGroup);

const nativeGroupId = '11111111-1111-4111-8111-111111111111';
const toolsGroupId = '22222222-2222-4222-8222-222222222222';
const bothGroupId = '33333333-3333-4333-8333-333333333333';
const emptyToolsGroupId = '44444444-4444-4444-8444-444444444444';
const publicToken = 'public-key';

const parseMcpResponse = (res: request.Response) => {
  if (res.body && Object.keys(res.body).length > 0) return res.body;
  const lines = res.text.split('\ndata: ');
  return JSON.parse(lines[lines.length - 1]);
};

const rpcModern = (
  method: string,
  params: Record<string, unknown> = {},
  endpoint = '/mcp/tools-group',
  clientCapabilities: Record<string, unknown> = {},
) =>
  request(server)
    .post(endpoint)
    .set('Authorization', `Bearer ${publicToken}`)
    .set('Accept', 'application/json, text/event-stream')
    .set('MCP-Protocol-Version', '2026-07-28')
    .set('Mcp-Method', method)
    .send({
      jsonrpc: '2.0',
      id: 1,
      method,
      params: {
        ...params,
        _meta: {
          'io.modelcontextprotocol/protocolVersion': '2026-07-28',
          'io.modelcontextprotocol/clientInfo': { name: 'modern-client', version: '1' },
          'io.modelcontextprotocol/clientCapabilities': clientCapabilities,
        },
      },
    });

const legacySession = async (endpoint: string) => {
  const initRes = await request(server)
    .post(endpoint)
    .set('Authorization', `Bearer ${publicToken}`)
    .set('Accept', 'application/json, text/event-stream')
    .send({
      jsonrpc: '2.0',
      id: 1,
      method: 'initialize',
      params: {
        protocolVersion: '2025-11-25',
        capabilities: {},
        clientInfo: { name: 'legacy-client', version: '1' },
      },
    })
    .expect(200);
  const sessionId = initRes.headers['mcp-session-id'];
  const initBody = parseMcpResponse(initRes);
  const call = async (method: string, params: Record<string, unknown> = {}) => {
    const res = await request(server)
      .post(endpoint)
      .set('Authorization', `Bearer ${publicToken}`)
      .set('Accept', 'application/json, text/event-stream')
      .set('mcp-session-id', sessionId)
      .send({ jsonrpc: '2.0', id: 2, method, params })
      .expect(200);
    return parseMcpResponse(res);
  };
  return { sessionId, initBody, call };
};

const importSkill = async (dir: string, files: Array<[string, Buffer]>) => {
  const payload = Buffer.from(
    JSON.stringify({
      directory: dir,
      files: files.map(([filePath, bytes]) => ({
        path: filePath,
        base64: bytes.toString('base64'),
      })),
    }),
  );
  const res = await request(server)
    .post('/api/skills')
    .set('X-Test-Admin', 'yes')
    .attach('directory', payload, 'skill.json')
    .expect(201);
  return res.body.data;
};

const publishSkill = async (id: string, groupIds: string[], enabled = true) => {
  await request(server)
    .put(`/api/skills/${id}`)
    .set('X-Test-Admin', 'yes')
    .send({ enabled, global: false, groupIds })
    .expect(200);
};

let directory: string;
const previousPath = process.env.MCPHUB_SETTING_PATH;

beforeAll(async () => {
  directory = fs.mkdtempSync(path.join(os.tmpdir(), 'mcphub-skills-delivery-'));
  process.env.MCPHUB_SETTING_PATH = path.join(directory, 'settings.json');
  fs.writeFileSync(
    process.env.MCPHUB_SETTING_PATH,
    JSON.stringify({
      mcpServers: {},
      users: [{ username: 'admin', password: 'unused', isAdmin: true }],
      groups: [
        {
          id: nativeGroupId,
          name: 'native-group',
          owner: 'admin',
          visibility: 'public',
          servers: [],
        },
        {
          id: toolsGroupId,
          name: 'tools-group',
          owner: 'admin',
          visibility: 'public',
          skillsDelivery: 'tools',
          servers: [],
        },
        {
          id: bothGroupId,
          name: 'both-group',
          owner: 'admin',
          visibility: 'public',
          skillsDelivery: 'both',
          servers: [],
        },
        {
          id: emptyToolsGroupId,
          name: 'empty-tools-group',
          owner: 'admin',
          visibility: 'public',
          skillsDelivery: 'tools',
          servers: [],
        },
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
  if (server) {
    (server as any).closeAllConnections?.();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
  fs.rmSync(directory, { recursive: true, force: true });
  if (previousPath === undefined) delete process.env.MCPHUB_SETTING_PATH;
  else process.env.MCPHUB_SETTING_PATH = previousPath;
});

beforeEach(() => {
  jest.spyOn(process, 'cwd').mockReturnValue(directory);
});

afterEach(() => {
  jest.restoreAllMocks();
  fs.rmSync(path.join(directory, 'data'), { recursive: true, force: true });
});

it('serves skills via MCP tools on tools/both groups, pages multibyte text & binary, and isolates native/other-group skills', async () => {
  const guideText = '你好🚀世界-line1\n你好🚀世界-line2\n';
  const binaryBytes = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x00, 0xff]);
  const mainSkill = await importSkill('team-guide', [
    [
      'SKILL.md',
      Buffer.from('---\nname: team-guide\ndescription: Team workflow guide\n---\nFollow these steps.\n'),
    ],
    ['references/guide.txt', Buffer.from(guideText, 'utf8')],
    ['assets/icon.bin', binaryBytes],
  ]);
  const secretSkill = await importSkill('secret-skill', [
    [
      'SKILL.md',
      Buffer.from('---\nname: secret-skill\ndescription: Secret skill\n---\nTop secret.\n'),
    ],
  ]);
  await publishSkill(mainSkill.id, [nativeGroupId, toolsGroupId, bothGroupId], true);
  await publishSkill(secretSkill.id, [nativeGroupId], true);

  const smart = await legacySession('/mcp/$smart/tools-group');
  const smartTools = await smart.call('tools/list');
  expect(smartTools.result.tools.map((tool: { name: string }) => tool.name)).toEqual(
    expect.arrayContaining(['mcphub_list_skills', 'mcphub_get_skill', 'mcphub_get_skill_file']),
  );

  // 1. Native group: 2025-11-25 client sees NO skill tools and NO skill instruction line
  const nativeLegacy = await legacySession('/mcp/native-group');
  expect(nativeLegacy.initBody.result.instructions ?? '').not.toContain('mcphub_list_skills');
  const nativeTools = await nativeLegacy.call('tools/list');
  expect(nativeTools.result.tools.map((t: any) => t.name)).not.toContain('mcphub_list_skills');

  // 2. Empty tools group (no published skills): no skill tools listed
  const emptyLegacy = await legacySession('/mcp/empty-tools-group');
  expect(emptyLegacy.initBody.result.instructions ?? '').not.toContain('mcphub_list_skills');
  const emptyTools = await emptyLegacy.call('tools/list');
  expect(emptyTools.result.tools.map((t: any) => t.name)).not.toContain('mcphub_list_skills');

  // 3. Tools group: 2025-11-25 client gets instruction, lists, reads, pages text & reads binary
  const toolsLegacy = await legacySession('/mcp/tools-group');
  expect(toolsLegacy.initBody.result.instructions).toContain(
    'Skills are available: call mcphub_list_skills',
  );
  const toolsList = await toolsLegacy.call('tools/list');
  const toolNames = toolsList.result.tools.map((t: any) => t.name);
  expect(toolNames).toEqual(
    expect.arrayContaining(['mcphub_list_skills', 'mcphub_get_skill', 'mcphub_get_skill_file']),
  );
  for (const tool of toolsList.result.tools) {
    if (tool.name.startsWith('mcphub_')) {
      expect(tool.annotations?.readOnlyHint).toBe(true);
    }
  }

  const listCall = await toolsLegacy.call('tools/call', {
    name: 'mcphub_list_skills',
    arguments: {},
  });
  expect(listCall.result.isError).toBeUndefined();
  const listed = JSON.parse(listCall.result.content[0].text);
  expect(listed.skills).toHaveLength(1);
  expect(listed.skills[0]).toMatchObject({
    name: 'team-guide',
    description: 'Team workflow guide',
  });
  const skillUri = listed.skills[0].uri;

  const getCall = await toolsLegacy.call('tools/call', {
    name: 'mcphub_get_skill',
    arguments: { uri: skillUri },
  });
  const got = JSON.parse(getCall.result.content[0].text);
  expect(got.content).toContain('Follow these steps.');
  expect(got.files.map((f: any) => f.path)).toEqual([
    'SKILL.md',
    'assets/icon.bin',
    'references/guide.txt',
  ]);

  // Page through multibyte UTF-8 text without splitting surrogate pairs
  const page1Call = await toolsLegacy.call('tools/call', {
    name: 'mcphub_get_skill_file',
    arguments: { uri: skillUri, path: 'references/guide.txt', offset: 0, limit: 3 },
  });
  const page1 = JSON.parse(page1Call.result.content[0].text);
  expect(page1.hasMore).toBe(true);
  const page2Call = await toolsLegacy.call('tools/call', {
    name: 'mcphub_get_skill_file',
    arguments: {
      uri: skillUri,
      path: 'references/guide.txt',
      offset: page1.nextOffset,
      limit: 100,
    },
  });
  const page2 = JSON.parse(page2Call.result.content[0].text);
  expect(page2.hasMore).toBe(false);
  expect(page1.content + page2.content).toBe(guideText);

  // Read small binary as base64
  const binCall = await toolsLegacy.call('tools/call', {
    name: 'mcphub_get_skill_file',
    arguments: { name: 'team-guide', path: 'assets/icon.bin' },
  });
  const bin = JSON.parse(binCall.result.content[0].text);
  expect(bin.encoding).toBe('base64');
  expect(Buffer.from(bin.content, 'base64')).toEqual(binaryBytes);

  // Secret skill from another group is invisible even by guessing name
  const secretCall = await toolsLegacy.call('tools/call', {
    name: 'mcphub_get_skill',
    arguments: { name: 'secret-skill' },
  });
  expect(secretCall.result.isError).toBe(true);

  // 4. Tools group on 2026-07-28: native extension is NOT advertised
  const toolsDiscover = await rpcModern('server/discover', {}, '/mcp/tools-group').expect(200);
  expect(toolsDiscover.body.result.capabilities.extensions ?? {}).not.toHaveProperty([
    'io.modelcontextprotocol/skills',
  ]);

  // 5. Both group (Option C):
  // - 2025-11-25 client gets skill tools
  const bothLegacy = await legacySession('/mcp/both-group');
  const bothLegacyTools = await bothLegacy.call('tools/list');
  expect(bothLegacyTools.result.tools.map((t: any) => t.name)).toContain('mcphub_list_skills');

  // - 2026-07-28 client declaring io.modelcontextprotocol/skills NEVER gets skill tools
  const bothNativeTools = await rpcModern(
    'tools/list',
    {},
    '/mcp/both-group',
    { extensions: { 'io.modelcontextprotocol/skills': {} } },
  ).expect(200);
  expect(bothNativeTools.body.result.tools.map((t: any) => t.name)).not.toContain(
    'mcphub_list_skills',
  );
  const bothNativeList = await rpcModern(
    'skills/list',
    {},
    '/mcp/both-group',
    { extensions: { 'io.modelcontextprotocol/skills': {} } },
  ).expect(200);
  expect(bothNativeList.body.result.skills).toHaveLength(1);
});

it('validates skillsDelivery on group create and update APIs', async () => {
  await request(server)
    .post('/api/groups')
    .set('X-Test-Admin', 'yes')
    .send({ name: 'invalid-delivery', skillsDelivery: 'invalid' })
    .expect(400);

  const created = await request(server)
    .post('/api/groups')
    .set('X-Test-Admin', 'yes')
    .send({ name: 'valid-delivery', skillsDelivery: 'both' })
    .expect(201);
  expect(created.body.data.skillsDelivery).toBe('both');

  await request(server)
    .put(`/api/groups/${created.body.data.id}`)
    .set('X-Test-Admin', 'yes')
    .send({ skillsDelivery: 'bad' })
    .expect(400);

  const updated = await request(server)
    .put(`/api/groups/${created.body.data.id}`)
    .set('X-Test-Admin', 'yes')
    .send({ skillsDelivery: 'tools' })
    .expect(200);
  expect(updated.body.data.skillsDelivery).toBe('tools');
});
