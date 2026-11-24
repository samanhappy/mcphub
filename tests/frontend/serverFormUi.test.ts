import fs from 'fs';
import path from 'path';
import type { ServerFormData } from '../../frontend/src/types';
import {
  getAvailableServerFormTabs,
  getServerFormSectionBadges,
  validateServerForm,
} from '../../frontend/src/utils/serverFormUi';

const createBaseForm = (overrides: Partial<ServerFormData> = {}): ServerFormData => ({
  name: 'demo-server',
  description: '',
  tags: [],
  url: '',
  command: 'npx',
  arguments: '',
  args: [],
  type: 'stdio',
  env: [],
  headers: [],
  passthroughHeaders: '',
  visibility: 'private',
  sharedWithUsers: [],
  sharedWithUserGroups: [],
  options: {
    timeout: 60000,
    resetTimeoutOnProgress: true,
  },
  oauth: {
    identityMode: 'shared',
    clientId: '',
    clientSecret: '',
  },
  keepAlive: {
    enabled: false,
    interval: 60000,
  },
  perSessionClient: false,
  credentialTemplate: [],
  startOnDemand: false,
  idleTimeoutMs: 300000,
  openapi: {
    inputMode: 'url',
    url: '',
    schema: '',
    version: '3.1.0',
    securityType: 'none',
    specSecurityType: 'none',
    specHttpScheme: 'basic',
    passthroughHeaders: '',
    cookieSession: false,
  },
  ...overrides,
});

describe('serverFormUi helpers', () => {
  describe('getAvailableServerFormTabs', () => {
    it('omits the runtime tab for openapi servers', () => {
      expect(getAvailableServerFormTabs('openapi')).toEqual(['connection', 'auth', 'access']);
    });

    it('returns all four tabs for stdio, sse, and streamable-http servers', () => {
      expect(getAvailableServerFormTabs('stdio')).toEqual([
        'connection',
        'auth',
        'access',
        'runtime',
      ]);
      expect(getAvailableServerFormTabs('sse')).toEqual([
        'connection',
        'auth',
        'access',
        'runtime',
      ]);
      expect(getAvailableServerFormTabs('streamable-http')).toEqual([
        'connection',
        'auth',
        'access',
        'runtime',
      ]);
    });
  });

  describe('getServerFormSectionBadges', () => {
    it('returns zero badges for a clean default stdio server', () => {
      expect(
        getServerFormSectionBadges({
          formData: createBaseForm(),
          serverType: 'stdio',
        }),
      ).toEqual({ connection: 0, auth: 0, access: 0, runtime: 0 });
    });

    it('counts configured visibility, credential slots, oauth, and runtime options', () => {
      const formData = createBaseForm({
        type: 'streamable-http',
        url: 'https://example.com/mcp',
        visibility: 'group',
        credentialTemplate: [
          { target: 'headers', name: 'X-Api-Key' },
          { target: 'headers', name: 'X-Tenant' },
        ],
        oauth: { identityMode: 'personal' },
        passthroughHeaders: 'Authorization',
        options: { timeout: 15000, resetTimeoutOnProgress: true },
        keepAlive: { enabled: true, interval: 30000 },
        perSessionClient: true,
      });

      expect(
        getServerFormSectionBadges({
          formData,
          serverType: 'streamable-http',
        }),
      ).toEqual({
        connection: 0,
        auth: 2,
        access: 3,
        runtime: 3,
      });
    });

    it('counts openapi security, spec security, cookie session, and passthrough headers', () => {
      const formData = createBaseForm({
        type: 'openapi',
        openapi: {
          inputMode: 'url',
          url: 'https://api.example.com/openapi.json',
          securityType: 'apiKey',
          specSecurityType: 'http',
          specHttpScheme: 'basic',
          cookieSession: true,
          passthroughHeaders: 'X-Request-Id',
        },
      });

      expect(
        getServerFormSectionBadges({
          formData,
          serverType: 'openapi',
        }),
      ).toEqual({
        connection: 0,
        auth: 4,
        access: 0,
        runtime: 0,
      });
    });
  });

  describe('validateServerForm', () => {
    it('validates required connection fields and targets the connection tab', () => {
      expect(
        validateServerForm({
          formData: createBaseForm({ name: '   ' }),
          serverType: 'stdio',
        }),
      ).toEqual({
        tab: 'connection',
        messageKey: 'server.validationNameRequired',
        focusId: 'server-name',
      });

      expect(
        validateServerForm({
          formData: createBaseForm({ command: '' }),
          serverType: 'stdio',
        }),
      ).toEqual({
        tab: 'connection',
        messageKey: 'server.validationCommandRequired',
        focusId: 'server-command',
      });

      expect(
        validateServerForm({
          formData: createBaseForm({ url: 'not-a-url' }),
          serverType: 'streamable-http',
        }),
      ).toEqual({
        tab: 'connection',
        messageKey: 'server.validationUrlRequired',
        focusId: 'server-url',
      });
    });

    it('allows editing an existing server with a legacy invalid name without renaming it', () => {
      expect(
        validateServerForm({
          formData: createBaseForm({ name: 'legacy server!' }),
          serverType: 'stdio',
          initialServerName: 'legacy server!',
        }),
      ).toBeNull();

      expect(
        validateServerForm({
          formData: createBaseForm({ name: 'still invalid!' }),
          serverType: 'stdio',
          initialServerName: 'legacy server!',
        }),
      ).toEqual({
        tab: 'connection',
        messageKey: 'server.nameInvalid',
        focusId: 'server-name',
      });
    });

    it('validates openapi schema JSON and personal oauth endpoints on their respective tabs', () => {
      expect(
        validateServerForm({
          formData: createBaseForm({
            openapi: {
              inputMode: 'schema',
              url: '',
              schema: '{invalid',
            },
          }),
          serverType: 'openapi',
        }),
      ).toEqual({
        tab: 'connection',
        messageKey: 'server.validationOpenApiSchemaInvalid',
        focusId: 'openapi-schema',
      });

      expect(
        validateServerForm({
          formData: createBaseForm({
            openapi: {
              inputMode: 'url',
              url: 'https://api.example.com/openapi.json',
            },
            oauth: {
              identityMode: 'personal',
              clientId: '',
            },
          }),
          serverType: 'openapi',
        }),
      ).toEqual({
        tab: 'auth',
        messageKey: 'server.validationPersonalOAuthRequired',
        focusId: 'openapi-personal-oauth-clientId',
      });
    });

    it('validates credential slots and runtime bounds on access and runtime tabs', () => {
      expect(
        validateServerForm({
          formData: createBaseForm({
            credentialTemplate: [{ target: 'env', name: '  ' }],
          }),
          serverType: 'stdio',
        }),
      ).toEqual({
        tab: 'access',
        messageKey: 'server.validationCredentialSlotNameRequired',
        focusId: 'credential-slot-name-0',
      });

      expect(
        validateServerForm({
          formData: createBaseForm({
            options: { timeout: 500, resetTimeoutOnProgress: true },
          }),
          serverType: 'stdio',
        }),
      ).toEqual({
        tab: 'runtime',
        messageKey: 'server.validationTimeoutRange',
        focusId: 'timeout',
      });
    });
  });

  describe('server form section i18n coverage', () => {
    const requiredKeys = [
      'sectionBasicInfo',
      'sectionConnection',
      'sectionAuth',
      'sectionAccess',
      'sectionRuntime',
      'sectionAdvanced',
      'tabConnection',
      'tabAuth',
      'tabAccess',
      'tabRuntime',
      'typeStdioHint',
      'typeStreamableHttpHint',
      'typeSseHint',
      'typeOpenapiHint',
      'addEnvVar',
      'addHeader',
      'optionalPlaceholder',
      'showSecret',
      'hideSecret',
      'sessionLifecycle',
      'saving',
      'adding',
    ];

    it('provides all new server form labels across every supported locale', () => {
      for (const locale of ['en', 'es', 'fr', 'tr', 'vi', 'zh']) {
        const localePath = path.join(process.cwd(), 'locales', `${locale}.json`);
        const translations = JSON.parse(fs.readFileSync(localePath, 'utf8'));
        for (const key of requiredKeys) {
          expect(translations.server[key]).toBeTruthy();
        }
      }
    });
  });
});
