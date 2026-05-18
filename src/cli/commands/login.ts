import { ApiClient } from '../http.js';
import { CliUsageError } from '../errors.js';
import { GlobalFlags } from '../context.js';
import { extractFlags } from '../parse-args.js';
import {
  Credentials,
  loadCredentials,
  saveCredentials,
  setProfile,
  getProfile,
} from '../profile.js';
import { green, yellow, printLine, printWarn } from '../output.js';
import { promptLine, promptPassword } from '../prompts.js';

interface LoginResponse {
  success: boolean;
  token: string;
  user: { username: string; isAdmin: boolean };
  isUsingDefaultPassword?: boolean;
  message?: string;
}

export interface LoginDeps {
  loadCreds?: () => Credentials;
  saveCreds?: (creds: Credentials) => void;
  createClient?: (baseUrl: string) => ApiClient;
  prompts?: {
    line: (q: string) => Promise<string>;
    password: (q: string) => Promise<string>;
  };
}

export async function run(args: string[], globals: GlobalFlags, deps: LoginDeps = {}): Promise<void> {
  const { flags } = extractFlags(args, {
    valued: ['--url', '--username', '--password', '--profile-name'],
  });

  const loadCreds = deps.loadCreds ?? loadCredentials;
  const saveCreds = deps.saveCreds ?? saveCredentials;
  const prompts = deps.prompts ?? { line: promptLine, password: promptPassword };

  const credentials = loadCreds();
  const targetProfileName =
    (flags['--profile-name'] as string | undefined) ||
    globals.profile ||
    credentials.current ||
    'default';
  const existing = getProfile(credentials, targetProfileName);

  const url =
    (flags['--url'] as string | undefined) ||
    globals.url ||
    existing?.url ||
    (await prompts.line('mcphub URL [http://localhost:3000]: ')) ||
    'http://localhost:3000';

  const username =
    (flags['--username'] as string | undefined) ||
    existing?.username ||
    (await prompts.line('Username [admin]: ')) ||
    'admin';

  const password =
    (flags['--password'] as string | undefined) || (await prompts.password('Password: '));

  if (!password) {
    throw new CliUsageError('Password is required.');
  }

  const client = deps.createClient ? deps.createClient(url) : new ApiClient({ baseUrl: url });
  const response = await client.post<LoginResponse>('/api/auth/login', { username, password });

  if (!response || !response.token) {
    throw new CliUsageError('Login response did not include a token.');
  }

  const next = setProfile(credentials, targetProfileName, {
    url,
    tokenKind: 'jwt',
    token: response.token,
    username: response.user?.username || username,
  });
  saveCreds(next);

  printLine(green(`Logged in as ${response.user?.username || username} at ${url}`));
  printLine(`Saved as profile "${targetProfileName}".`);

  if (response.isUsingDefaultPassword) {
    printWarn('Warning: this account is still using the default password. Change it soon.');
  }
}

export async function logout(args: string[], globals: GlobalFlags, deps: LoginDeps = {}): Promise<void> {
  const loadCreds = deps.loadCreds ?? loadCredentials;
  const saveCreds = deps.saveCreds ?? saveCredentials;
  const credentials = loadCreds();
  const targetName = globals.profile || credentials.current;
  if (!targetName || !credentials.profiles[targetName]) {
    throw new CliUsageError('No active profile to log out from.');
  }
  const existing = credentials.profiles[targetName];
  const next = setProfile(credentials, targetName, {
    url: existing.url,
    username: existing.username,
    // token + tokenKind dropped intentionally
  });
  saveCreds(next);
  printLine(yellow(`Cleared token for profile "${targetName}".`));
  // Silence unused-arg warning while keeping the signature consistent.
  void args;
}
