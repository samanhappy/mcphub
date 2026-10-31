import assert from 'node:assert/strict';
import * as client from 'openid-client';
import { initializeDatabaseMode } from '../../../dist/utils/migration.js';
import { closeDatabase } from '../../../dist/db/connection.js';
import { getServerDao } from '../../../dist/dao/DaoFactory.js';
import { refreshAccessToken } from '../../../dist/services/oauthClientRegistration.js';

try {
  assert.equal(await initializeDatabaseMode(), true);
  const server = await getServerDao().findById('refresh-fixture');
  assert.ok(server);
  const config = new client.Configuration({
    issuer: 'http://upstream:4000', token_endpoint: 'http://upstream:4000/oauth/token',
  }, 'fixture-client', undefined, client.None());
  client.allowInsecureRequests(config);
  const tokens = await refreshAccessToken('refresh-fixture', server, { config, clientId: 'fixture-client' }, 'refresh-0');
  assert.equal(tokens.accessToken, 'access-1');
  assert.equal(tokens.refreshToken, 'refresh-1');
} finally {
  await closeDatabase();
}
