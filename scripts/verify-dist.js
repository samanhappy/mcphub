// scripts/verify-dist.js
import fs from 'fs';
import assert from 'node:assert/strict';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const projectRoot = path.resolve(__dirname, '..');

// Check if frontend dist exists
const frontendDistPath = path.join(projectRoot, 'frontend', 'dist');
const frontendIndexPath = path.join(frontendDistPath, 'index.html');

if (!fs.existsSync(frontendDistPath)) {
  console.error('❌ Error: frontend/dist directory does not exist!');
  console.error('Run "npm run frontend:build" to generate the frontend dist files.');
  process.exit(1);
}

if (!fs.existsSync(frontendIndexPath)) {
  console.error('❌ Error: frontend/dist/index.html does not exist!');
  console.error('Frontend build may be incomplete. Run "npm run frontend:build" again.');
  process.exit(1);
}

// Check if backend dist exists
const backendDistPath = path.join(projectRoot, 'dist');
const serverJsPath = path.join(backendDistPath, 'server.js');

if (!fs.existsSync(backendDistPath)) {
  console.error('❌ Error: dist directory does not exist!');
  console.error('Run "npm run backend:build" to generate the backend dist files.');
  process.exit(1);
}

if (!fs.existsSync(serverJsPath)) {
  console.error('❌ Error: dist/server.js does not exist!');
  console.error('Backend build may be incomplete. Run "npm run backend:build" again.');
  process.exit(1);
}

const cliMainPath = path.join(backendDistPath, 'cli', 'main.js');
if (!fs.existsSync(cliMainPath)) {
  console.error('❌ Error: dist/cli/main.js does not exist!');
  console.error('CLI subcommand dispatch will fail. Run "npm run backend:build" again.');
  process.exit(1);
}

// npm installs do not apply pnpm patches. Verify the bundled OAuth client
// retains both the TLS default and the explicit per-provider exception.
const { refreshAuthorization, InsecureTokenEndpointError } = await import(
  '../dist/clients/mcpSdkClient.js'
);
const tokenOptions = {
  clientInformation: { client_id: 'distribution-check' },
  refreshToken: 'fake-refresh-token',
  fetchFn: async () => Response.json({ access_token: 'fake-access-token', token_type: 'Bearer' }),
};
await assert.rejects(
  refreshAuthorization('http://upstream.example', tokenOptions),
  InsecureTokenEndpointError,
);
const tokens = await refreshAuthorization('http://upstream.example', {
  ...tokenOptions,
  allowInsecureTokenEndpoint: () => true,
});
assert.equal(tokens.access_token, 'fake-access-token');

// All checks passed
console.log('✅ Verification passed! Frontend and backend dist files are present.');
console.log('📦 Package is ready for publishing.');
