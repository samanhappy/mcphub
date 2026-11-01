import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

it('completes OIDC login using the installed Better Auth routes', async () => {
  const { stdout } = await promisify(execFile)(
    process.execPath,
    ['--import', 'tsx', 'tests/fixtures/better-auth-oidc.mts'],
    { cwd: process.cwd(), timeout: 20000 },
  );
  expect(stdout).toContain('OIDC sign-in, PKCE, callback and session passed');
}, 25000);
