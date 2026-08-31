const mockGet = jest.fn();

jest.mock('../../src/dao/DaoFactory.js', () => ({
  getSystemConfigDao: jest.fn(() => ({
    get: mockGet,
  })),
}));

import { getSmartRoutingConfig } from '../../src/utils/smartRouting.js';

// List of every smart-routing-related env var this suite manipulates. We delete
// them all in beforeEach so global setup (tests/setup.ts sets DB_URL, etc.) does
// not leak into the 3-layer resolution being tested.
const SMART_ROUTING_ENV_VARS = [
  'SMART_ROUTING_ENABLED',
  'ENABLE_SMART_ROUTING',
  'DB_URL',
  'SMART_ROUTING_BASE_PACING_DELAY_MS',
  'SMART_ROUTING_EMBEDDING_PROVIDER',
  'SMART_ROUTING_EMBEDDING_ENCODING_FORMAT',
  'EMBEDDING_DIMENSIONS',
  'OPENAI_API_BASE_URL',
  'OPENAI_API_KEY',
  'EMBEDDING_MODEL',
  'OPENAI_API_EMBEDDING_MODEL',
  'AZURE_OPENAI_ENDPOINT',
  'AZURE_OPENAI_API_KEY',
  'AZURE_OPENAI_API_VERSION',
  'AZURE_OPENAI_EMBEDDING_DEPLOYMENT',
  'AZURE_OPENAI_EMBEDDING_MODEL',
  'SMART_ROUTING_PROGRESSIVE_DISCLOSURE',
  'SMART_ROUTING_SERVER_DESCRIPTION_MODE',
  'EMBEDDING_MAX_TOKENS',
];

describe('smartRouting config resolution', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    jest.clearAllMocks();
    // Robust env isolation: clone then strip every var this suite touches so the
    // global tests/setup.ts values (DB_URL='sqlite::memory:') do not interfere.
    process.env = { ...originalEnv };
    for (const key of SMART_ROUTING_ENV_VARS) {
      delete process.env[key];
    }
    // Default: empty settings so defaults / env are exercised.
    mockGet.mockResolvedValue({ smartRouting: {} });
  });

  afterAll(() => {
    process.env = originalEnv;
  });

  // parseBooleanEnvVar is private; exercised indirectly through `enabled`
  // (env: SMART_ROUTING_ENABLED / ENABLE_SMART_ROUTING) and `progressiveDisclosure`
  // (env: SMART_ROUTING_PROGRESSIVE_DISCLOSURE / settings passthrough).
  describe('parseBooleanEnvVar (via enabled / progressiveDisclosure)', () => {
    it.each(['true', '1', 'yes', 'on', 'TRUE', 'True', 'YES'])(
      'treats %s as truthy',
      async (value) => {
        process.env.SMART_ROUTING_ENABLED = value;
        const config = await getSmartRoutingConfig();
        expect(config.enabled).toBe(true);
      },
    );

    it('accepts the legacy ENABLE_SMART_ROUTING alias', async () => {
      process.env.ENABLE_SMART_ROUTING = 'true';
      const config = await getSmartRoutingConfig();
      expect(config.enabled).toBe(true);
    });

    it('prefers SMART_ROUTING_ENABLED over the legacy alias', async () => {
      process.env.SMART_ROUTING_ENABLED = 'false';
      process.env.ENABLE_SMART_ROUTING = 'true';
      const config = await getSmartRoutingConfig();
      expect(config.enabled).toBe(false);
    });

    it.each(['false', '0', 'no', 'off'])('treats %s as falsy', async (value) => {
      process.env.SMART_ROUTING_ENABLED = value;
      const config = await getSmartRoutingConfig();
      expect(config.enabled).toBe(false);
    });

    it("treats empty-string env '' as not set → falls to settings/default (false)", async () => {
      process.env.SMART_ROUTING_ENABLED = '';
      const config = await getSmartRoutingConfig();
      expect(config.enabled).toBe(false);
    });

    it.each(['maybe', '2'])('treats unrecognized %s as false', async (value) => {
      process.env.SMART_ROUTING_ENABLED = value;
      const config = await getSmartRoutingConfig();
      expect(config.enabled).toBe(false);
    });

    it('passes through a direct boolean from settings (enabled = true)', async () => {
      mockGet.mockResolvedValue({ smartRouting: { enabled: true } });
      const config = await getSmartRoutingConfig();
      expect(config.enabled).toBe(true);
    });

    it('passes through a direct boolean from settings (progressiveDisclosure = true)', async () => {
      mockGet.mockResolvedValue({ smartRouting: { progressiveDisclosure: true } });
      const config = await getSmartRoutingConfig();
      expect(config.progressiveDisclosure).toBe(true);
    });

    it('reads progressiveDisclosure truthy from env', async () => {
      process.env.SMART_ROUTING_PROGRESSIVE_DISCLOSURE = 'yes';
      const config = await getSmartRoutingConfig();
      expect(config.progressiveDisclosure).toBe(true);
    });
  });

  describe('getConfigValue priority chain', () => {
    it('env var overrides settings', async () => {
      process.env.OPENAI_API_KEY = 'sk-from-env';
      mockGet.mockResolvedValue({ smartRouting: { openaiApiKey: 'sk-from-settings' } });
      const config = await getSmartRoutingConfig();
      expect(config.openaiApiKey).toBe('sk-from-env');
    });

    it('settings overrides default when no env is present', async () => {
      mockGet.mockResolvedValue({ smartRouting: { openaiApiKey: 'sk-from-settings' } });
      const config = await getSmartRoutingConfig();
      expect(config.openaiApiKey).toBe('sk-from-settings');
    });

    it('uses default when env is undefined and settings is undefined', async () => {
      mockGet.mockResolvedValue({ smartRouting: {} });
      const config = await getSmartRoutingConfig();
      expect(config.openaiApiKey).toBe('');
    });

    it('uses default when env is undefined and settings is null', async () => {
      mockGet.mockResolvedValue({ smartRouting: { openaiApiKey: null } });
      const config = await getSmartRoutingConfig();
      expect(config.openaiApiKey).toBe('');
    });

    // Empty-string env is treated as "not set" and falls through to settings.
    // NOTE: the transformers used here (expandEnvVars, the numeric/enum ones) are
    // total — they do not throw for realistic inputs — so the transformer-throws
    // `continue`/fall-to-settings path cannot be exercised with real values
    // without modifying src (out of scope). We instead cover the equivalent
    // "empty env string falls through to settings" fall-through path.
    it('empty-string env falls through to settings value', async () => {
      process.env.OPENAI_API_KEY = '';
      mockGet.mockResolvedValue({ smartRouting: { openaiApiKey: 'sk-from-settings' } });
      const config = await getSmartRoutingConfig();
      expect(config.openaiApiKey).toBe('sk-from-settings');
    });

    it('accepts the legacy OpenAI embedding model alias', async () => {
      process.env.OPENAI_API_EMBEDDING_MODEL = 'legacy-embedding-model';
      const config = await getSmartRoutingConfig();
      expect(config.openaiApiEmbeddingModel).toBe('legacy-embedding-model');
    });

    it('prefers EMBEDDING_MODEL over the legacy model alias', async () => {
      process.env.EMBEDDING_MODEL = 'canonical-embedding-model';
      process.env.OPENAI_API_EMBEDDING_MODEL = 'legacy-embedding-model';
      const config = await getSmartRoutingConfig();
      expect(config.openaiApiEmbeddingModel).toBe('canonical-embedding-model');
    });
  });

  describe('getSmartRoutingConfig integration — defaults with empty settings & no env', () => {
    it('returns all documented defaults', async () => {
      const config = await getSmartRoutingConfig();
      expect(config).toEqual({
        enabled: false,
        dbUrl: '',
        basePacingDelayMs: 0,
        embeddingProvider: 'openai',
        embeddingEncodingFormat: 'auto',
        embeddingDimensions: undefined,
        openaiApiBaseUrl: 'https://api.openai.com/v1',
        openaiApiKey: '',
        openaiApiEmbeddingModel: 'text-embedding-3-small',
        azureOpenaiEndpoint: '',
        azureOpenaiApiKey: '',
        azureOpenaiApiVersion: '2024-02-15-preview',
        azureOpenaiEmbeddingDeployment: '',
        azureOpenaiEmbeddingModel: '',
        progressiveDisclosure: false,
        serverDescriptionMode: 'names',
        embeddingMaxTokens: undefined,
      });
    });
  });

  describe('field transformers', () => {
    describe('dbUrl (expandEnvVars)', () => {
      it('uses env value', async () => {
        process.env.DB_URL = 'postgres://env/db';
        const config = await getSmartRoutingConfig();
        expect(config.dbUrl).toBe('postgres://env/db');
      });

      it('uses settings when no env', async () => {
        mockGet.mockResolvedValue({ smartRouting: { dbUrl: 'postgres://settings/db' } });
        const config = await getSmartRoutingConfig();
        expect(config.dbUrl).toBe('postgres://settings/db');
      });

      it("defaults to '' when neither set", async () => {
        const config = await getSmartRoutingConfig();
        expect(config.dbUrl).toBe('');
      });

      it('expands ${VAR} references from process.env and trims', async () => {
        process.env.DB_HOST = 'db.example.com';
        process.env.DB_URL = '  postgres://${DB_HOST}/x  ';
        const config = await getSmartRoutingConfig();
        expect(config.dbUrl).toBe('postgres://db.example.com/x');
        delete process.env.DB_HOST;
      });
    });

    describe('basePacingDelayMs', () => {
      it("parses '250' → 250", async () => {
        process.env.SMART_ROUTING_BASE_PACING_DELAY_MS = '250';
        const config = await getSmartRoutingConfig();
        expect(config.basePacingDelayMs).toBe(250);
      });

      it("NaN 'abc' → 0", async () => {
        process.env.SMART_ROUTING_BASE_PACING_DELAY_MS = 'abc';
        const config = await getSmartRoutingConfig();
        expect(config.basePacingDelayMs).toBe(0);
      });

      it("negative '-5' → 0", async () => {
        process.env.SMART_ROUTING_BASE_PACING_DELAY_MS = '-5';
        const config = await getSmartRoutingConfig();
        expect(config.basePacingDelayMs).toBe(0);
      });
    });

    describe('embeddingProvider', () => {
      it("'azure' → 'azure_openai'", async () => {
        process.env.SMART_ROUTING_EMBEDDING_PROVIDER = 'azure';
        const config = await getSmartRoutingConfig();
        expect(config.embeddingProvider).toBe('azure_openai');
      });

      it("'azure_openai' → 'azure_openai'", async () => {
        process.env.SMART_ROUTING_EMBEDDING_PROVIDER = 'azure_openai';
        const config = await getSmartRoutingConfig();
        expect(config.embeddingProvider).toBe('azure_openai');
      });

      it("'invalid' → 'openai'", async () => {
        process.env.SMART_ROUTING_EMBEDDING_PROVIDER = 'invalid';
        const config = await getSmartRoutingConfig();
        expect(config.embeddingProvider).toBe('openai');
      });
    });

    describe('embeddingEncodingFormat', () => {
      it("'base64' → 'base64'", async () => {
        process.env.SMART_ROUTING_EMBEDDING_ENCODING_FORMAT = 'base64';
        const config = await getSmartRoutingConfig();
        expect(config.embeddingEncodingFormat).toBe('base64');
      });

      it("'float' → 'float'", async () => {
        process.env.SMART_ROUTING_EMBEDDING_ENCODING_FORMAT = 'float';
        const config = await getSmartRoutingConfig();
        expect(config.embeddingEncodingFormat).toBe('float');
      });

      it("'bogus' → 'auto'", async () => {
        process.env.SMART_ROUTING_EMBEDDING_ENCODING_FORMAT = 'bogus';
        const config = await getSmartRoutingConfig();
        expect(config.embeddingEncodingFormat).toBe('auto');
      });
    });

    describe('embeddingDimensions', () => {
      it("parses '768' → 768", async () => {
        process.env.EMBEDDING_DIMENSIONS = '768';
        const config = await getSmartRoutingConfig();
        expect(config.embeddingDimensions).toBe(768);
      });

      it('uses the settings value when the environment variable is absent', async () => {
        mockGet.mockResolvedValue({ smartRouting: { embeddingDimensions: 1536 } });
        const config = await getSmartRoutingConfig();
        expect(config.embeddingDimensions).toBe(1536);
      });

      it.each(['0', '-1', '1.5', 'not-a-number'])('rejects invalid value %s', async (value) => {
        process.env.EMBEDDING_DIMENSIONS = value;
        const config = await getSmartRoutingConfig();
        expect(config.embeddingDimensions).toBeUndefined();
      });
    });

    describe('serverDescriptionMode', () => {
      it("'full' → 'full'", async () => {
        process.env.SMART_ROUTING_SERVER_DESCRIPTION_MODE = 'full';
        const config = await getSmartRoutingConfig();
        expect(config.serverDescriptionMode).toBe('full');
      });

      it("'verbose' → 'names'", async () => {
        process.env.SMART_ROUTING_SERVER_DESCRIPTION_MODE = 'verbose';
        const config = await getSmartRoutingConfig();
        expect(config.serverDescriptionMode).toBe('names');
      });
    });

    describe('embeddingMaxTokens', () => {
      it("'8000' → 8000", async () => {
        process.env.EMBEDDING_MAX_TOKENS = '8000';
        const config = await getSmartRoutingConfig();
        expect(config.embeddingMaxTokens).toBe(8000);
      });

      it("'0' → undefined", async () => {
        process.env.EMBEDDING_MAX_TOKENS = '0';
        const config = await getSmartRoutingConfig();
        expect(config.embeddingMaxTokens).toBeUndefined();
      });

      it("'-1' → undefined", async () => {
        process.env.EMBEDDING_MAX_TOKENS = '-1';
        const config = await getSmartRoutingConfig();
        expect(config.embeddingMaxTokens).toBeUndefined();
      });

      it("NaN 'nope' → undefined", async () => {
        process.env.EMBEDDING_MAX_TOKENS = 'nope';
        const config = await getSmartRoutingConfig();
        expect(config.embeddingMaxTokens).toBeUndefined();
      });
    });
  });

  describe('settings override via mockGet', () => {
    it('uses settings values when env absent', async () => {
      mockGet.mockResolvedValue({
        smartRouting: { openaiApiKey: 'sk-set', embeddingProvider: 'azure' },
      });
      const config = await getSmartRoutingConfig();
      expect(config.openaiApiKey).toBe('sk-set');
      expect(config.embeddingProvider).toBe('azure_openai');
    });

    it('env wins when both env and settings present', async () => {
      process.env.SMART_ROUTING_EMBEDDING_PROVIDER = 'openai';
      mockGet.mockResolvedValue({ smartRouting: { embeddingProvider: 'azure' } });
      const config = await getSmartRoutingConfig();
      expect(config.embeddingProvider).toBe('openai');
    });

    it('falls back to defaults when systemConfig.smartRouting is undefined', async () => {
      mockGet.mockResolvedValue({});
      const config = await getSmartRoutingConfig();
      expect(config.enabled).toBe(false);
      expect(config.serverDescriptionMode).toBe('names');
    });
  });
});
