import {
  DEFAULT_FILE_STAGING_SETTINGS,
  assertStagingConfigConsistent,
  normalizeFileStagingSettings,
  normalizeServerStaging,
  normalizeToolFileStaging,
  resolveFileStagingSettings,
} from '../fileStagingConfig.js';
import { normalizeServerConfigForPersistence } from '../serverConfigPersistence.js';
import { ServerConfigValidationError } from '../serverConfigValidation.js';
import { validateSshServerConfig } from '../../services/fileStaging/adapter.js';

describe('file staging configuration', () => {
  describe('resolveFileStagingSettings', () => {
    it('is disabled by default with conservative limits', () => {
      const settings = resolveFileStagingSettings(undefined);
      expect(settings).toEqual(DEFAULT_FILE_STAGING_SETTINGS);
      expect(settings.enabled).toBe(false);
    });

    it('clamps invalid numbers instead of throwing', () => {
      const settings = resolveFileStagingSettings({
        ttlHours: 0,
        maxFileBytes: -5,
        downloadTtlSeconds: 999999,
        enabled: true,
      });
      expect(settings.ttlHours).toBe(1);
      expect(settings.maxFileBytes).toBe(1);
      expect(settings.downloadTtlSeconds).toBe(3600);
      expect(settings.enabled).toBe(true);
    });

    it('never lets inline uploads exceed the tool-file ceiling', () => {
      const settings = resolveFileStagingSettings({ maxFileBytes: 1024, inlineMaxBytes: 4096 });
      expect(settings.inlineMaxBytes).toBe(1024);
    });
  });

  describe('normalizeFileStagingSettings', () => {
    it('returns only supplied keys so a PATCH merges over stored values', () => {
      expect(normalizeFileStagingSettings({ ttlHours: 48 })).toEqual({ ttlHours: 48 });
      expect(normalizeFileStagingSettings({})).toBeUndefined();
      expect(normalizeFileStagingSettings(undefined)).toBeUndefined();
    });

    it('rejects unknown keys and non-positive values', () => {
      expect(() => normalizeFileStagingSettings({ nope: 1 })).toThrow(ServerConfigValidationError);
      expect(() => normalizeFileStagingSettings({ maxFileBytes: 0 })).toThrow(
        ServerConfigValidationError,
      );
    });
  });

  describe('normalizeServerStaging', () => {
    it('accepts an owner-only adapter declaration', () => {
      expect(normalizeServerStaging({ adapter: 'ssh' })).toEqual({ adapter: 'ssh' });
    });

    it('requires an adapter when shared is enabled', () => {
      expect(() => normalizeServerStaging({ shared: true })).toThrow(ServerConfigValidationError);
      expect(normalizeServerStaging({ shared: true, adapter: 'ssh' })).toEqual({
        shared: true,
        adapter: 'ssh',
      });
    });

    it('rejects unknown adapters', () => {
      expect(() => normalizeServerStaging({ adapter: 'filesystem' })).toThrow(
        ServerConfigValidationError,
      );
    });

    it('drops an empty declaration', () => {
      expect(normalizeServerStaging({})).toBeUndefined();
    });
  });

  describe('normalizeToolFileStaging', () => {
    it('accepts input-only and output-only tools', () => {
      expect(normalizeToolFileStaging({ enabled: true, inputParams: ['localPath'] }, 'upload')).toEqual(
        { enabled: true, inputParams: ['localPath'] },
      );
      expect(
        normalizeToolFileStaging({ enabled: true, outputParams: ['localPath'] }, 'download'),
      ).toEqual({ enabled: true, outputParams: ['localPath'] });
    });

    it('rejects enabled tools without params', () => {
      expect(() => normalizeToolFileStaging({ enabled: true }, 'upload')).toThrow(
        ServerConfigValidationError,
      );
    });

    it('rejects overlapping, duplicate, and empty param names', () => {
      expect(() =>
        normalizeToolFileStaging(
          { enabled: true, inputParams: ['p'], outputParams: ['p'] },
          'tool',
        ),
      ).toThrow(ServerConfigValidationError);
      expect(() => normalizeToolFileStaging({ enabled: true, inputParams: ['a', 'a'] }, 'tool')).toThrow(
        ServerConfigValidationError,
      );
      expect(() => normalizeToolFileStaging({ enabled: true, inputParams: ['  '] }, 'tool')).toThrow(
        ServerConfigValidationError,
      );
    });

    it('keeps a disabled tool minimal', () => {
      expect(normalizeToolFileStaging({ enabled: false }, 'tool')).toEqual({ enabled: false });
    });

    it('keeps declared params when the tool is disabled (R33)', () => {
      expect(
        normalizeToolFileStaging(
          { enabled: false, inputParams: ['localPath'], outputParams: ['dest'] },
          'tool',
        ),
      ).toEqual({ enabled: false, inputParams: ['localPath'], outputParams: ['dest'] });
    });
  });

  describe('assertStagingConfigConsistent', () => {
    it('requires a server adapter for any staged tool', () => {
      expect(() =>
        assertStagingConfigConsistent({
          tools: { upload: { enabled: true, fileStaging: { enabled: true, inputParams: ['p'] } } },
        }),
      ).toThrow(ServerConfigValidationError);
    });

    it('accepts staged tools when the adapter is declared', () => {
      expect(() =>
        assertStagingConfigConsistent({
          staging: { adapter: 'ssh' },
          tools: { upload: { enabled: true, fileStaging: { enabled: true, inputParams: ['p'] } } },
        }),
      ).not.toThrow();
    });
  });

  describe('normalizeServerConfigForPersistence', () => {
    it('normalizes tool staging and keeps unrelated tool fields', () => {
      const config = normalizeServerConfigForPersistence({
        command: 'npx',
        args: ['-y', 'pkg'],
        staging: { adapter: 'ssh' },
        tools: {
          upload: {
            enabled: true,
            description: 'upload',
            hiddenParams: ['x'],
            fileStaging: { enabled: true, inputParams: ['localPath'] },
          },
        },
      });
      expect(config.staging).toEqual({ adapter: 'ssh' });
      expect(config.tools?.upload).toEqual({
        enabled: true,
        description: 'upload',
        hiddenParams: ['x'],
        fileStaging: { enabled: true, inputParams: ['localPath'] },
      });
    });

    it('drops explicit undefined tools/staging so a DAO update cannot null them', () => {
      const config = normalizeServerConfigForPersistence({
        command: 'npx',
        args: ['-y', 'pkg'],
        tools: undefined,
        staging: undefined,
      });
      expect(Object.prototype.hasOwnProperty.call(config, 'tools')).toBe(false);
      expect(Object.prototype.hasOwnProperty.call(config, 'staging')).toBe(false);
    });


    it('treats DB NULL columns as absent instead of failing the round-trip', () => {
      const config = normalizeServerConfigForPersistence({
        type: 'stdio',
        command: 'npx',
        args: ['-y', 'pkg'],
        tools: null,
        staging: null,
      } as unknown as Parameters<typeof normalizeServerConfigForPersistence>[0]);
      expect(Object.prototype.hasOwnProperty.call(config, 'tools')).toBe(false);
      expect(Object.prototype.hasOwnProperty.call(config, 'staging')).toBe(false);
    });

    it('rejects a staged parameter that is also hidden', () => {
      expect(() =>
        normalizeServerConfigForPersistence({
          command: 'npx',
          args: ['-y', 'pkg'],
          staging: { adapter: 'ssh' },
          tools: {
            upload: {
              enabled: true,
              hiddenParams: ['localPath'],
              fileStaging: { enabled: true, inputParams: ['localPath'] },
            },
          },
        }),
      ).toThrow(ServerConfigValidationError);
    });

    it('rejects staging on a non-stdio server', () => {
      expect(() =>
        normalizeServerConfigForPersistence({
          type: 'streamable-http',
          url: 'https://example.com/mcp',
          staging: { adapter: 'ssh' },
          tools: {
            upload: { enabled: true, fileStaging: { enabled: true, inputParams: ['p'] } },
          },
        }),
      ).toThrow(ServerConfigValidationError);
    });

    it('rejects staged tools without a server adapter, including through round-trips', () => {
      expect(() =>
        normalizeServerConfigForPersistence({
          command: 'npx',
          args: ['-y', 'pkg'],
          tools: {
            upload: { enabled: true, fileStaging: { enabled: true, inputParams: ['localPath'] } },
          },
        }),
      ).toThrow(ServerConfigValidationError);
    });

    it('rejects shared staging without per-user credential slots (R22 trust)', () => {
      expect(() =>
        normalizeServerConfigForPersistence({
          type: 'stdio',
          command: 'npx',
          args: ['-y', '@fangjunjie/ssh-mcp-server@1.11.0'],
          staging: { shared: true, adapter: 'ssh' },
          tools: {
            upload: { enabled: true, fileStaging: { enabled: true, inputParams: ['localPath'] } },
          },
        }),
      ).toThrow(/Shared file staging requires per-user credential slots/);
    });

    it('accepts shared staging when per-user credential slots are declared', () => {
      expect(() =>
        normalizeServerConfigForPersistence({
          type: 'stdio',
          command: 'npx',
          args: ['-y', '@fangjunjie/ssh-mcp-server@1.11.0', '{{args.ssh_host}}'],
          staging: { shared: true, adapter: 'ssh' },
          credentialTemplate: [{ target: 'args', name: 'ssh_host' }],
          tools: {
            upload: { enabled: true, fileStaging: { enabled: true, inputParams: ['localPath'] } },
          },
        }),
      ).not.toThrow();
    });

    it('does not block saving on adapter profile drift (R22)', () => {
      // Wrong pinned version: dispatch re-validates at call time and disables
      // staging for this server, but the config must stay editable.
      const wrongVersion = normalizeServerConfigForPersistence({
        type: 'stdio',
        command: 'npx',
        args: ['-y', '@fangjunjie/ssh-mcp-server@1.10.0'],
        staging: { adapter: 'ssh' },
        tools: {
          upload: { enabled: true, fileStaging: { enabled: true, inputParams: ['localPath'] } },
        },
      });
      expect(validateSshServerConfig(wrongVersion)).toMatchObject({ ok: false });

      // Forbidden local-root flag: same profile-drift class, not a save error.
      const forbiddenFlag = normalizeServerConfigForPersistence({
        type: 'stdio',
        command: 'npx',
        args: ['-y', '@fangjunjie/ssh-mcp-server@1.11.0', '--allowed-local-paths=/'],
        staging: { adapter: 'ssh' },
        tools: {
          upload: { enabled: true, fileStaging: { enabled: true, inputParams: ['localPath'] } },
        },
      });
      expect(validateSshServerConfig(forbiddenFlag)).toMatchObject({ ok: false });
    });
  });
});
