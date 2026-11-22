import {
  computeDirtyFields,
  mergeDraftValues,
} from '../../frontend/src/hooks/useSettingsDraft';

describe('useSettingsDraft pure helpers', () => {
  it('preserves unsaved user edits when unrelated remote fields update', () => {
    const initialRemote = {
      baseUrl: 'https://old.example.com',
      basePath: '/api/auth/better',
      oidcPrompt: '',
    };

    // User edits baseUrl without saving yet
    const draft = { baseUrl: 'https://new.example.com' };

    // An immediate Switch in the same section triggers a remote config update
    const updatedRemote = {
      ...initialRemote,
      basePath: '/api/auth/v2',
    };

    const merged = mergeDraftValues(updatedRemote, draft);
    expect(merged.baseUrl).toBe('https://new.example.com');
    expect(merged.basePath).toBe('/api/auth/v2');
    expect(computeDirtyFields(updatedRemote, draft)).toEqual({
      baseUrl: 'https://new.example.com',
    });
  });

  it('clears dirty state when an edited field is reverted back to the remote value', () => {
    const remote = { minTokens: '2000', maxOutputTokens: '1200' };
    const draft = { minTokens: '2000' };

    expect(computeDirtyFields(remote, draft)).toEqual({});
  });

  it('returns the remote object directly when no draft fields exist', () => {
    const remote = { jsonBodyLimit: '1mb' };
    expect(mergeDraftValues(remote, {})).toBe(remote);
  });
});
