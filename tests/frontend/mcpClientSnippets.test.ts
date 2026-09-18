import {
  buildClientSnippetBlocks,
  CLIENT_SNIPPET_PRESETS,
  DEFAULT_CLIENT_SNIPPET_ID,
  toClientSnippetTarget,
  type ClientSnippetTarget,
} from '../../frontend/src/utils/mcpClientSnippets';

const httpTarget: ClientSnippetTarget = {
  name: 'u8',
  url: 'https://hub.example.com/mcp/u8',
  headers: { Authorization: 'Bearer <your-access-token>' },
};

const stdioTarget: ClientSnippetTarget = {
  name: 'time',
  command: 'npx',
  args: ['-y', 'time-mcp'],
  env: { TZ: 'Asia/Shanghai' },
};

const configOf = (id: Parameters<typeof buildClientSnippetBlocks>[0], target: ClientSnippetTarget) =>
  buildClientSnippetBlocks(id, target).find((block) => block.kind === 'config')?.text ?? '';

describe('buildClientSnippetBlocks', () => {
  it('lists every preset with a stable id and a label key', () => {
    expect(CLIENT_SNIPPET_PRESETS.length).toBeGreaterThanOrEqual(14);
    const ids = CLIENT_SNIPPET_PRESETS.map((preset) => preset.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids).toEqual(
      expect.arrayContaining([
        'generic-mcp-servers',
        'generic-http',
        'claude-code',
        'cursor',
        'vscode',
        'codex',
        'opencode',
      ]),
    );
  });

  it('keeps the historical mcpServers shape as the first preset', () => {
    expect(CLIENT_SNIPPET_PRESETS[0].id).toBe('generic-mcp-servers');
    expect(DEFAULT_CLIENT_SNIPPET_ID).toBe(CLIENT_SNIPPET_PRESETS[0].id);
    expect(JSON.parse(configOf('generic-mcp-servers', httpTarget))).toEqual({
      mcpServers: {
        u8: {
          url: 'https://hub.example.com/mcp/u8',
          headers: { Authorization: 'Bearer <your-access-token>' },
        },
      },
    });
  });

  it('emits the bare HTTP entry for the generic preset', () => {
    expect(JSON.parse(configOf('generic-http', httpTarget))).toEqual({
      type: 'http',
      url: 'https://hub.example.com/mcp/u8',
      headers: { Authorization: 'Bearer <your-access-token>' },
    });
  });

  it('wraps the mcpServers clients around the HTTP entry', () => {
    expect(JSON.parse(configOf('cursor', httpTarget))).toEqual({
      mcpServers: {
        u8: {
          url: 'https://hub.example.com/mcp/u8',
          headers: { Authorization: 'Bearer <your-access-token>' },
        },
      },
    });
  });

  it('uses the stdio transport fields when the target is a command', () => {
    expect(JSON.parse(configOf('cursor', stdioTarget))).toEqual({
      mcpServers: {
        time: {
          command: 'npx',
          args: ['-y', 'time-mcp'],
          env: { TZ: 'Asia/Shanghai' },
        },
      },
    });
  });

  it('omits headers when the target has none', () => {
    const blocks = configOf('cursor', { name: 'u8', url: 'https://hub.example.com/mcp/u8' });

    expect(JSON.parse(blocks)).toEqual({
      mcpServers: { u8: { url: 'https://hub.example.com/mcp/u8' } },
    });
  });

  it('asks VS Code for the token through an input prompt', () => {
    expect(JSON.parse(configOf('vscode', httpTarget))).toEqual({
      servers: {
        u8: {
          type: 'http',
          url: 'https://hub.example.com/mcp/u8',
          headers: { Authorization: 'Bearer ${input:mcphub-token}' },
        },
      },
      inputs: [
        {
          id: 'mcphub-token',
          type: 'promptString',
          description: 'MCPHub access token',
          password: true,
        },
      ],
    });
  });

  it('keeps a concrete VS Code header verbatim and skips the input prompt', () => {
    const blocks = configOf('vscode', {
      name: 'u8',
      url: 'https://hub.example.com/mcp/u8',
      headers: { Authorization: 'Bearer abc123', 'X-Env': 'prod' },
    });

    expect(JSON.parse(blocks)).toEqual({
      servers: {
        u8: {
          type: 'http',
          url: 'https://hub.example.com/mcp/u8',
          headers: { Authorization: 'Bearer abc123', 'X-Env': 'prod' },
        },
      },
    });
  });

  it('marks stdio servers as such for VS Code', () => {
    expect(JSON.parse(configOf('vscode', stdioTarget))).toEqual({
      servers: {
        time: { type: 'stdio', command: 'npx', args: ['-y', 'time-mcp'], env: { TZ: 'Asia/Shanghai' } },
      },
    });
  });

  it('writes Codex HTTP servers with http_headers instead of a headers key', () => {
    const snippet = configOf('codex', httpTarget);

    expect(snippet).toContain('[mcp_servers.u8]');
    expect(snippet).toContain('url = "https://hub.example.com/mcp/u8"');
    expect(snippet).toContain('http_headers = { Authorization = "Bearer <your-access-token>" }');
    expect(snippet).not.toMatch(/^headers\s*=/m);
  });

  it('quotes Codex table keys that are not bare TOML keys', () => {
    const name = 'u8 组';
    const snippet = configOf('codex', { ...httpTarget, name });

    expect(snippet).toContain('[mcp_servers."u8 组"]');
    expect(snippet).toContain('url = "https://hub.example.com/mcp/u8"');
  });

  it('quotes Codex table keys containing dots', () => {
    const snippet = configOf('codex', { ...httpTarget, name: 'com.example.hub' });

    expect(snippet).toContain('[mcp_servers."com.example.hub"]');
  });

  it('writes Codex stdio servers with command, args and an env table', () => {
    const snippet = configOf('codex', stdioTarget);

    expect(snippet).toContain('[mcp_servers.time]');
    expect(snippet).toContain('command = "npx"');
    expect(snippet).toContain('args = ["-y", "time-mcp"]');
    expect(snippet).toContain('[mcp_servers.time.env]');
    expect(snippet).toContain('TZ = "Asia/Shanghai"');
  });

  it('marks remote OpenCode servers as remote', () => {
    expect(JSON.parse(configOf('opencode', httpTarget))).toEqual({
      mcp: {
        u8: {
          type: 'remote',
          url: 'https://hub.example.com/mcp/u8',
          headers: { Authorization: 'Bearer <your-access-token>' },
        },
      },
    });
  });

  it('collapses the OpenCode stdio command into an array', () => {
    expect(JSON.parse(configOf('opencode', stdioTarget))).toEqual({
      mcp: {
        time: {
          type: 'local',
          command: ['npx', '-y', 'time-mcp'],
          environment: { TZ: 'Asia/Shanghai' },
        },
      },
    });
  });

  it('uses baseUrl and streamableHttp for Cherry Studio', () => {
    expect(JSON.parse(configOf('cherry-studio', httpTarget))).toEqual({
      mcpServers: {
        u8: {
          name: 'u8',
          description: '',
          type: 'streamableHttp',
          baseUrl: 'https://hub.example.com/mcp/u8',
          headers: { Authorization: 'Bearer <your-access-token>' },
          isActive: true,
        },
      },
    });
  });

  it('uses the stdio shape for Cherry Studio servers without a URL', () => {
    expect(JSON.parse(configOf('cherry-studio', stdioTarget))).toEqual({
      mcpServers: {
        time: {
          name: 'time',
          description: '',
          type: 'stdio',
          command: 'npx',
          args: ['-y', 'time-mcp'],
          env: { TZ: 'Asia/Shanghai' },
          isActive: true,
        },
      },
    });
  });

  it('adds the Claude Code CLI command next to the JSON block', () => {
    const blocks = buildClientSnippetBlocks('claude-code', httpTarget);

    expect(blocks.map((block) => block.kind)).toEqual(['config', 'command']);
    expect(JSON.parse(blocks[0].text)).toEqual({
      mcpServers: {
        u8: {
          url: 'https://hub.example.com/mcp/u8',
          headers: { Authorization: 'Bearer <your-access-token>' },
        },
      },
    });
    expect(blocks[1].text).toBe(
      'claude mcp add --transport http u8 https://hub.example.com/mcp/u8 --header "Authorization: Bearer <your-access-token>"',
    );
  });

  it('omits the CLI block for stdio targets it cannot express', () => {
    const blocks = buildClientSnippetBlocks('claude-code', stdioTarget);

    expect(blocks.map((block) => block.kind)).toEqual(['config']);
  });

  it.each(CLIENT_SNIPPET_PRESETS.map((preset) => preset.id))(
    'produces a non-empty config block for %s over HTTP and stdio',
    (id) => {
      expect(configOf(id, httpTarget).trim().length).toBeGreaterThan(0);
      expect(configOf(id, stdioTarget).trim().length).toBeGreaterThan(0);
    },
  );
});

describe('toClientSnippetTarget', () => {
  it('keeps only the fields a client snippet needs', () => {
    const target = toClientSnippetTarget('u8', {
      type: 'streamable-http',
      url: 'https://hub.example.com/mcp/u8',
      headers: { Authorization: 'Bearer abc' },
      visibility: 'group',
      owner: 'admin',
      enabled: true,
      tools: { 'u8-alpha': { enabled: false } },
      options: { timeout: 60000 },
      description: 'team endpoint',
    });

    expect(target).toEqual({
      name: 'u8',
      url: 'https://hub.example.com/mcp/u8',
      headers: { Authorization: 'Bearer abc' },
      description: 'team endpoint',
    });
  });

  it('maps a stdio config onto command, args and env', () => {
    const target = toClientSnippetTarget('time', {
      type: 'stdio',
      command: 'npx',
      args: ['-y', 'time-mcp'],
      env: { TZ: 'UTC' },
      owner: 'admin',
    });

    expect(target).toEqual({
      name: 'time',
      command: 'npx',
      args: ['-y', 'time-mcp'],
      env: { TZ: 'UTC' },
    });
  });

  it('ignores values of the wrong shape', () => {
    const target = toClientSnippetTarget('x', {
      url: 42,
      headers: 'nope',
      args: 'nope',
      env: null,
      description: 7,
    });

    expect(target).toEqual({ name: 'x' });
  });
});
