import { describe, expect, it } from '@jest/globals';
import {
  buildParamRoleMap,
  buildServerStagingPayload,
  buildStagingParamOptions,
  buildToolFileStagingPayload,
  extractStagingParamCandidates,
  getServerStagingSyncKey,
  getToolFileStagingSyncKey,
  isServerStagingDirty,
  isToolFileStagingDirty,
} from '../../frontend/src/utils/fileStaging';

describe('frontend fileStaging utils', () => {
  it('extracts string and untyped leaf dot-paths and skips non-string properties', () => {
    const candidates = extractStagingParamCandidates({
      type: 'object',
      required: ['localPath', 'options'],
      properties: {
        localPath: { type: 'string', description: 'Local file path' },
        remotePath: { type: 'string' },
        port: { type: 'number' },
        overwrite: { type: 'boolean' },
        tags: { type: 'array' },
        untyped: { description: 'Any value' },
        emptyObj: { type: 'object' },
        options: {
          type: 'object',
          required: ['dest'],
          properties: {
            dest: { type: 'string' },
            retries: { type: 'integer' },
          },
        },
      },
    });

    expect(candidates).toEqual([
      { path: 'localPath', description: 'Local file path', required: true },
      { path: 'remotePath', description: undefined, required: false },
      { path: 'untyped', description: 'Any value', required: false },
      { path: 'options.dest', description: undefined, required: true },
    ]);
  });

  it('flags hidden parameters and appends stale configured parameters', () => {
    const options = buildStagingParamOptions(
      {
        type: 'object',
        properties: {
          localPath: { type: 'string' },
          nested: {
            type: 'object',
            properties: {
              file: { type: 'string' },
            },
          },
        },
      },
      {
        enabled: true,
        inputParams: ['localPath', 'removedParam'],
        outputParams: ['nested.file'],
      },
      ['localPath', 'nested'],
    );

    expect(options).toEqual([
      { path: 'localPath', description: undefined, required: false, hidden: true, stale: false },
      { path: 'nested.file', description: undefined, required: false, hidden: true, stale: false },
      { path: 'removedParam', required: false, hidden: false, stale: true },
    ]);
  });

  it('builds role maps, dirty state, and PATCH payloads with null clear sentinels', () => {
    const initial = {
      enabled: true,
      inputParams: ['src'],
      outputParams: ['dest'],
    };

    const roles = buildParamRoleMap(initial);
    expect(roles).toEqual({ src: 'input', dest: 'output' });
    expect(isToolFileStagingDirty(true, roles, initial)).toBe(false);

    // Clearing inputParams emits null sentinel while preserving outputParams.
    const nextRoles = { dest: 'output' as const };
    expect(isToolFileStagingDirty(true, nextRoles, initial)).toBe(true);
    expect(buildToolFileStagingPayload('transfer', true, nextRoles, initial)).toEqual({
      tool: 'transfer',
      enabled: true,
      inputParams: null,
      outputParams: ['dest'],
    });

    // When neither direction was previously set, omitting them keeps payload minimal.
    expect(buildToolFileStagingPayload('upload', false, {}, undefined)).toEqual({
      tool: 'upload',
      enabled: false,
    });
  });

  it('builds server staging payloads respecting admin vs non-admin permissions', () => {
    expect(isServerStagingDirty('ssh', false, { adapter: 'ssh' }, false)).toBe(false);
    expect(isServerStagingDirty('', false, { adapter: 'ssh' }, false)).toBe(true);

    // Non-admin clearing adapter sends adapter: null and never sends shared.
    expect(buildServerStagingPayload('', false, { adapter: 'ssh' }, false)).toEqual({
      adapter: null,
    });

    // Non-admin cannot change shared even if draftShared differs.
    expect(buildServerStagingPayload('ssh', true, { adapter: 'ssh', shared: false }, false)).toEqual(
      {},
    );

    // Admin clearing shared + adapter sends both in one PATCH payload.
    expect(
      buildServerStagingPayload('', false, { adapter: 'ssh', shared: true }, true),
    ).toEqual({
      adapter: null,
      shared: false,
    });
  });

  it('produces stable sync keys across freshly deserialized equal configs and changes on real updates', () => {
    // Polling returns new object references with identical values: sync key must stay equal.
    const poll1 = { enabled: true, inputParams: ['b', 'a'], outputParams: ['out'] };
    const poll2 = { enabled: true, inputParams: ['a', 'b'], outputParams: ['out'] };
    expect(getToolFileStagingSyncKey('ssh', 'ssh-upload', poll1)).toBe(
      getToolFileStagingSyncKey('ssh', 'ssh-upload', poll2),
    );
    expect(getToolFileStagingSyncKey('ssh', 'ssh-upload', undefined)).toBe(
      getToolFileStagingSyncKey('ssh', 'ssh-upload', { enabled: false }),
    );

    // Changing values, tool name, or server name must change the sync key.
    expect(getToolFileStagingSyncKey('ssh', 'ssh-upload', poll1)).not.toBe(
      getToolFileStagingSyncKey('ssh', 'ssh-upload', { ...poll1, enabled: false }),
    );
    expect(getToolFileStagingSyncKey('ssh', 'ssh-upload', poll1)).not.toBe(
      getToolFileStagingSyncKey('ssh', 'ssh-upload', { ...poll1, inputParams: ['a'] }),
    );
    expect(getToolFileStagingSyncKey('ssh', 'ssh-upload', poll1)).not.toBe(
      getToolFileStagingSyncKey('ssh', 'ssh-download', poll1),
    );
    expect(getToolFileStagingSyncKey('ssh', 'ssh-upload', poll1)).not.toBe(
      getToolFileStagingSyncKey('ssh2', 'ssh-upload', poll1),
    );

    // Server staging sync key is also invariant to fresh object references and sensitive to real changes.
    expect(getServerStagingSyncKey('ssh', { adapter: 'ssh', shared: false })).toBe(
      getServerStagingSyncKey('ssh', { adapter: 'ssh' }),
    );
    expect(getServerStagingSyncKey('ssh', { adapter: 'ssh' })).not.toBe(
      getServerStagingSyncKey('ssh', { adapter: 'ssh', shared: true }),
    );
    expect(getServerStagingSyncKey('ssh', { adapter: 'ssh' })).not.toBe(
      getServerStagingSyncKey('ssh2', { adapter: 'ssh' }),
    );
  });
});
