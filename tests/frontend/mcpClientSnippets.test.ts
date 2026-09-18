import {
  buildClientSnippetBlocks,
  CLIENT_SNIPPET_PRESETS,
  DEFAULT_CLIENT_SNIPPET_ID,
  toClientSnippetTarget,
  type ClientSnippetId,
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

const HTTP_ENTRY = {
  url: 'https://hub.example.com/mcp/u8',
  headers: { Authorization: 'Bearer <your-access-token>' },
};

const STDIO_ENTRY = {
  command: 'npx',
  args: ['-y', 'time-mcp'],
  env: { TZ: 'Asia/Shanghai' },
};

const MCP_SERVERS_HTTP = { mcpServers: { u8: HTTP_ENTRY } };
const MCP_SERVERS_STDIO = { mcpServers: { time: STDIO_ENTRY } };

describe('buildClientSnippetBlocks', () => {
  it('lists exactly the fourteen presets in their tab order', () => {
    expect(CLIENT_SNIPPET_PRESETS.map((preset) => preset.id)).toEqual([
      'generic-mcp-servers',
      'claude-code',
      'cursor',
      'vscode',
      'codex',
      'opencode',
      'windsurf',
      'cherry-studio',
      'codebuddy',
      'qoder',
      'trae',
      'zcode',
      'workbuddy',
      'generic-http',
    ]);
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
        },
      },
    });
  });

  it('omits Cherry Studio install metadata from the pasted config', () => {
    // `isActive` is rejected by ProtocolMcpServerConfigSchema (strict object)
    // and must be `false` under ProtocolMcpServerInstallSchema; it belongs to
    // the install request, never to this hand-pasted entry.
    for (const target of [httpTarget, stdioTarget]) {
      const parsed = JSON.parse(configOf('cherry-studio', target)) as {
        mcpServers: Record<string, Record<string, unknown>>;
      };
      for (const entry of Object.values(parsed.mcpServers)) {
        expect(entry).not.toHaveProperty('isActive');
        expect(entry).not.toHaveProperty('installSource');
        expect(entry).not.toHaveProperty('isTrusted');
        expect(entry).not.toHaveProperty('installedAt');
      }
    }
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
      "claude mcp add --transport http u8 https://hub.example.com/mcp/u8 --header 'Authorization: Bearer <your-access-token>'",
    );
  });

  it('omits the CLI block for stdio targets it cannot express', () => {
    const blocks = buildClientSnippetBlocks('claude-code', stdioTarget);

    expect(blocks.map((block) => block.kind)).toEqual(['config']);
  });

  it('single-quotes CLI arguments outside the safe charset', () => {
    const blocks = buildClientSnippetBlocks('claude-code', {
      name: 'inject',
      url: 'https://hub.example.com/mcp/inject?x=$(echo INJECTED)`id`${HOME}',
      headers: { Authorization: "Bearer a'b\\c\nd" },
    });
    const command = blocks.find((block) => block.kind === 'command')?.text ?? '';

    // Safe values stay bare.
    expect(command.startsWith('claude mcp add --transport http inject ')).toBe(true);
    // Unsafe values are wrapped in single quotes so `$(...)`, backticks and
    // `${...}` are never expanded by the pasting shell; an embedded quote
    // becomes the standard `'\''` escape.
    expect(command).toContain(
      "'https://hub.example.com/mcp/inject?x=$(echo INJECTED)`id`${HOME}'",
    );
    expect(command).toContain(`--header 'Authorization: Bearer a'\\''b\\c\nd'`);
    expect(command).not.toContain('"Authorization');
  });

  it('marks SSE servers as sse for VS Code instead of http', () => {
    const sseTarget: ClientSnippetTarget = {
      name: 'legacy',
      type: 'sse',
      url: 'https://hub.example.com/sse',
      headers: { Authorization: 'Bearer <your-access-token>' },
    };

    expect(JSON.parse(configOf('vscode', sseTarget))).toEqual({
      servers: {
        legacy: {
          type: 'sse',
          url: 'https://hub.example.com/sse',
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

  it('labels generic presets with type sse only for SSE servers', () => {
    const sseTarget: ClientSnippetTarget = {
      name: 'legacy',
      type: 'sse',
      url: 'https://hub.example.com/sse',
    };

    expect(configOf('generic-mcp-servers', sseTarget)).toContain('"type": "sse"');
    expect(JSON.parse(configOf('generic-http', sseTarget))).toEqual({
      type: 'sse',
      url: 'https://hub.example.com/sse',
    });
  });

  it('keeps the default shapes for streamable-http targets', () => {
    const target: ClientSnippetTarget = { ...httpTarget, type: 'streamable-http' };

    expect(JSON.parse(configOf('generic-mcp-servers', target))).toEqual({
      mcpServers: { u8: HTTP_ENTRY },
    });
    expect(JSON.parse(configOf('generic-http', target))).toEqual({
      type: 'http',
      ...HTTP_ENTRY,
    });
    expect(JSON.parse(configOf('vscode', target)).servers.u8.type).toBe('http');
  });

  it('passes the transport through to the Claude Code CLI flag', () => {
    const commandOf = (target: ClientSnippetTarget) =>
      buildClientSnippetBlocks('claude-code', target).find((block) => block.kind === 'command')
        ?.text ?? '';

    expect(commandOf({ ...httpTarget, type: 'sse' })).toContain('--transport sse');
    expect(commandOf(httpTarget)).toContain('--transport http');
  });

  it('returns no blocks for OpenAPI-backed servers without a transport', () => {
    const openApiTarget = toClientSnippetTarget('probe', {
      type: 'openapi',
      openapi: { specUrl: 'https://example.com/openapi.json' },
      description: 'REST facade',
    });

    expect(openApiTarget).toEqual({
      name: 'probe',
      type: 'openapi',
      description: 'REST facade',
    });
    for (const preset of CLIENT_SNIPPET_PRESETS) {
      expect(buildClientSnippetBlocks(preset.id, openApiTarget)).toEqual([]);
    }
    expect(buildClientSnippetBlocks('generic-mcp-servers', { name: 'bare' })).toEqual([]);
  });

  it('escapes TOML values into single-line basic strings', () => {
    const snippet = configOf('codex', {
      name: 'esc',
      url: 'https://hub.example.com/mcp/esc?q="quoted"\\slash\n中文',
      headers: { 'X-Multi': "line1\nline2 'unquoted'" },
    });

    // JSON-style escaping keeps every value a legal TOML basic string: quotes,
    // backslashes and newlines only ever appear escaped, CJK stays literal.
    expect(snippet).toContain('url = "https://hub.example.com/mcp/esc?q=\\"quoted\\"\\\\slash\\n中文"');
    expect(snippet).toContain("X-Multi = \"line1\\nline2 'unquoted'\"");
    expect(snippet).toMatch(/^url = "(?:[^"\\\n]|\\.)*"$/m);
    expect(snippet).toMatch(/^http_headers = \{ X-Multi = "(?:[^"\\\n]|\\.)*" \}$/m);
  });
});

type PresetShape = { http: unknown; stdio: unknown };

// Exact shape every preset must emit for the shared HTTP and stdio targets.
// `codex` emits TOML, so its two shapes are compared as whole strings.
const PRESET_SHAPES: Record<ClientSnippetId, PresetShape> = {
  'generic-mcp-servers': { http: MCP_SERVERS_HTTP, stdio: MCP_SERVERS_STDIO },
  'generic-http': {
    http: { type: 'http', ...HTTP_ENTRY },
    stdio: STDIO_ENTRY,
  },
  'claude-code': { http: MCP_SERVERS_HTTP, stdio: MCP_SERVERS_STDIO },
  cursor: { http: MCP_SERVERS_HTTP, stdio: MCP_SERVERS_STDIO },
  vscode: {
    http: {
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
    },
    stdio: {
      servers: {
        time: { type: 'stdio', command: 'npx', args: ['-y', 'time-mcp'], env: { TZ: 'Asia/Shanghai' } },
      },
    },
  },
  codex: {
    http: [
      '[mcp_servers.u8]',
      'url = "https://hub.example.com/mcp/u8"',
      'http_headers = { Authorization = "Bearer <your-access-token>" }',
    ].join('\n'),
    stdio: [
      '[mcp_servers.time]',
      'command = "npx"',
      'args = ["-y", "time-mcp"]',
      '',
      '[mcp_servers.time.env]',
      'TZ = "Asia/Shanghai"',
    ].join('\n'),
  },
  opencode: {
    http: {
      mcp: {
        u8: {
          type: 'remote',
          url: 'https://hub.example.com/mcp/u8',
          headers: { Authorization: 'Bearer <your-access-token>' },
        },
      },
    },
    stdio: {
      mcp: {
        time: {
          type: 'local',
          command: ['npx', '-y', 'time-mcp'],
          environment: { TZ: 'Asia/Shanghai' },
        },
      },
    },
  },
  windsurf: { http: MCP_SERVERS_HTTP, stdio: MCP_SERVERS_STDIO },
  'cherry-studio': {
    http: {
      mcpServers: {
        u8: {
          name: 'u8',
          description: '',
          type: 'streamableHttp',
          baseUrl: 'https://hub.example.com/mcp/u8',
          headers: { Authorization: 'Bearer <your-access-token>' },
        },
      },
    },
    stdio: {
      mcpServers: {
        time: {
          name: 'time',
          description: '',
          type: 'stdio',
          command: 'npx',
          args: ['-y', 'time-mcp'],
          env: { TZ: 'Asia/Shanghai' },
        },
      },
    },
  },
  codebuddy: { http: MCP_SERVERS_HTTP, stdio: MCP_SERVERS_STDIO },
  qoder: { http: MCP_SERVERS_HTTP, stdio: MCP_SERVERS_STDIO },
  trae: { http: MCP_SERVERS_HTTP, stdio: MCP_SERVERS_STDIO },
  zcode: { http: MCP_SERVERS_HTTP, stdio: MCP_SERVERS_STDIO },
  workbuddy: { http: MCP_SERVERS_HTTP, stdio: MCP_SERVERS_STDIO },
};

describe('preset shape locks', () => {
  it.each(Object.entries(PRESET_SHAPES) as [ClientSnippetId, PresetShape][])(
    'locks the exact config shape for %s over HTTP and stdio',
    (id, { http, stdio }) => {
      const httpText = configOf(id, httpTarget);
      const stdioText = configOf(id, stdioTarget);

      if (typeof http === 'string' && typeof stdio === 'string') {
        expect(httpText).toBe(http);
        expect(stdioText).toBe(stdio);
        return;
      }

      expect(JSON.parse(httpText)).toEqual(http);
      expect(JSON.parse(stdioText)).toEqual(stdio);
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
      type: 'streamable-http',
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
      type: 'stdio',
      command: 'npx',
      args: ['-y', 'time-mcp'],
      env: { TZ: 'UTC' },
    });
  });

  it('ignores values of the wrong shape', () => {
    const target = toClientSnippetTarget('x', {
      type: 'grpc',
      url: 42,
      headers: 'nope',
      args: 'nope',
      env: null,
      description: 7,
    });

    expect(target).toEqual({ name: 'x' });
  });
});
