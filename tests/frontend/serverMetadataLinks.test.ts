import type { Server, ServerFormData } from '../../frontend/src/types';
import { getInitialMetadataLinks } from '../../frontend/src/utils/serverMetadataLinks';
import { buildServerPayload } from '../../frontend/src/utils/serverFormPayload';

const toFormData = (links: Pick<ServerFormData, 'repositoryUrl' | 'documentationUrl'>) =>
  ({
    name: 'github-server',
    description: '',
    tags: [],
    url: '',
    command: 'npx',
    arguments: '',
    args: [],
    type: 'stdio',
    env: [],
    headers: [],
    visibility: 'private',
    sharedWithUsers: [],
    sharedWithUserGroups: [],
    options: { timeout: 60000, resetTimeoutOnProgress: true },
    oauth: { identityMode: 'shared', clientId: '', clientSecret: '' },
    keepAlive: { enabled: false, interval: 60000 },
    perSessionClient: false,
    credentialTemplate: [],
    startOnDemand: false,
    ...links,
  }) as ServerFormData;

const storedServer = (): Server =>
  ({
    name: 'github-server',
    status: 'disconnected',
    config: {
      command: 'npx',
      args: ['-y', 'server-github'],
      repositoryUrl: 'https://github.com/owner/repo',
      documentationUrl: 'https://docs.example.com',
    },
  }) as Server;

describe('getInitialMetadataLinks (#1495 review)', () => {
  it('seeds both stored links into the edit form', () => {
    expect(getInitialMetadataLinks(storedServer())).toEqual({
      repositoryUrl: 'https://github.com/owner/repo',
      documentationUrl: 'https://docs.example.com',
    });
  });

  it('seeds nothing for the add form, which has no initial data', () => {
    expect(getInitialMetadataLinks(null)).toEqual({
      repositoryUrl: undefined,
      documentationUrl: undefined,
    });
  });

  it('keeps the seeded links through an unrelated edit save', () => {
    const seeded = getInitialMetadataLinks(storedServer());
    const payload = buildServerPayload({
      formData: {
        ...toFormData(seeded),
        // The maintainer's repro: change only the description, save.
        description: 'A renamed copy of the server',
      },
      serverType: 'stdio',
      envVars: [],
      headerVars: [],
    });

    expect(payload.config.repositoryUrl).toBe('https://github.com/owner/repo');
    expect(payload.config.documentationUrl).toBe('https://docs.example.com');
  });

  it('clears a link the user emptied, even though it was seeded', () => {
    const seeded = getInitialMetadataLinks(storedServer());
    const payload = buildServerPayload({
      formData: { ...toFormData(seeded), repositoryUrl: '   ' },
      serverType: 'stdio',
      envVars: [],
      headerVars: [],
    });

    expect(payload.config.repositoryUrl).toBeUndefined();
    expect(payload.config.documentationUrl).toBe('https://docs.example.com');
  });
});
