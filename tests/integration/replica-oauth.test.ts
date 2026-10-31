import { DataSource } from 'typeorm';
import { OAuthState as mockStateEntity } from '../../src/db/entities/OAuthState.js';

let mockSource: DataSource;
jest.mock('../../src/db/connection.js', () => ({ getAppDataSource: () => mockSource }));

const dbSuite = process.env.MCPHUB_TEST_PG_PORT ? describe : describe.skip;
dbSuite('OAuth state across independent replicas', () => {
  let first: typeof import('../../src/models/OAuth.js');
  let second: typeof first;
  const oldMode = process.env.MCPHUB_REPLICA_MODE;

  beforeAll(async () => {
    process.env.MCPHUB_REPLICA_MODE = 'true';
    mockSource = new DataSource({
      type: 'postgres',
      host: '127.0.0.1',
      port: Number(process.env.MCPHUB_TEST_PG_PORT),
      username: 'mcphub_test',
      password: 'mcphub_test',
      database: 'mcphub_test',
      entities: [mockStateEntity],
      synchronize: true,
    });
    await mockSource.initialize();
    await jest.isolateModulesAsync(async () => {
      first = await import('../../src/models/OAuth.js');
    });
    await jest.isolateModulesAsync(async () => {
      second = await import('../../src/models/OAuth.js');
    });
  });
  afterAll(async () => {
    await mockSource?.getRepository(mockStateEntity).clear();
    await mockSource?.destroy();
    if (oldMode === undefined) delete process.env.MCPHUB_REPLICA_MODE;
    else process.env.MCPHUB_REPLICA_MODE = oldMode;
  });

  test('a code created on A can be read on B and consumed only once', async () => {
    const code = await first.saveAuthorizationCode({
      clientId: 'replica-test',
      username: 'alice',
      sessionVersion: 'version',
      redirectUri: 'https://client.example/callback',
    });
    expect(await second.getAuthorizationCode(code)).toEqual(
      expect.objectContaining({
        code,
        clientId: 'replica-test',
        expiresAt: expect.any(Date),
      }),
    );
    const consumed = await Promise.all([
      first.revokeAuthorizationCode(code),
      second.revokeAuthorizationCode(code),
    ]);
    expect(consumed.filter(Boolean)).toHaveLength(1);
    expect(await first.getAuthorizationCode(code)).toBeUndefined();
  });

  test('registration management works on B and revocation is visible on A', async () => {
    const token = await first.createRegistrationToken('replica-test');
    const stored = await mockSource.getRepository(mockStateEntity).find();
    expect(JSON.stringify(stored)).not.toContain(token);
    expect(await second.verifyRegistrationToken(token)).toBe('replica-test');
    await second.deleteRegistrationToken(token);
    expect(await first.verifyRegistrationToken(token)).toBeNull();
  });

  test('expired authorization codes and registration tokens cannot be used on B', async () => {
    const code = await first.saveAuthorizationCode(
      {
        clientId: 'replica-test',
        username: 'alice',
        redirectUri: 'https://client.example/callback',
      },
      -1,
    );
    const token = await first.createRegistrationToken('replica-test', -1);
    expect(await second.getAuthorizationCode(code)).toBeUndefined();
    expect(await second.verifyRegistrationToken(token)).toBeNull();
  });
});
