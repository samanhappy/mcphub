import { ApiClient, TokenKind } from './http.js';
import { CliUsageError } from './errors.js';
import {
  Credentials,
  getProfile,
  loadCredentials,
  Profile,
} from './profile.js';

export interface GlobalFlags {
  url?: string;
  token?: string;
  bearer?: boolean;
  profile?: string;
  json?: boolean;
  debug?: boolean;
}

export interface ResolvedTarget {
  baseUrl: string;
  token?: string;
  tokenKind: TokenKind;
  profileName?: string;
}

// Resolve where requests should go and what token to use, in this order:
// 1. CLI flags (--url / --token / --bearer)
// 2. Environment variables (MCPHUB_URL / MCPHUB_TOKEN / MCPHUB_TOKEN_KIND)
// 3. Active profile in credentials.json (--profile <name> or current)
// Commands that only need a URL (e.g. discover) call resolveTargetForPublic()
// instead, which doesn't require a token.

export function resolveTarget(globals: GlobalFlags, creds?: Credentials): ResolvedTarget {
  const credentials = creds ?? loadCredentials();
  const profile: Profile | undefined = getProfile(credentials, globals.profile);

  const baseUrl = globals.url ?? process.env.MCPHUB_URL ?? profile?.url;
  if (!baseUrl) {
    throw new CliUsageError(
      'No mcphub URL configured. Use --url <url>, MCPHUB_URL env, or run `mcphub login`.',
    );
  }
  const tokenKind: TokenKind =
    (globals.bearer ? 'bearer' : undefined) ??
    (process.env.MCPHUB_TOKEN_KIND as TokenKind | undefined) ??
    profile?.tokenKind ??
    'jwt';
  const token = globals.token ?? process.env.MCPHUB_TOKEN ?? profile?.token;
  if (!token) {
    throw new CliUsageError(
      'Not logged in. Use --token <token>, MCPHUB_TOKEN env, or run `mcphub login`.',
    );
  }
  return { baseUrl, token, tokenKind, profileName: globals.profile ?? credentials.current };
}

export function resolveTargetForPublic(
  globals: GlobalFlags,
  remote?: string,
  creds?: Credentials,
): { baseUrl: string } {
  const credentials = creds ?? loadCredentials();
  const profile = getProfile(credentials, globals.profile);
  const baseUrl = remote ?? globals.url ?? process.env.MCPHUB_URL ?? profile?.url;
  if (!baseUrl) {
    throw new CliUsageError(
      'No mcphub URL configured. Use --remote <url>, --url <url>, MCPHUB_URL env, or run `mcphub login`.',
    );
  }
  return { baseUrl };
}

export function buildClient(target: ResolvedTarget, fetchImpl?: typeof fetch): ApiClient {
  return new ApiClient({
    baseUrl: target.baseUrl,
    token: target.token,
    tokenKind: target.tokenKind,
    fetchImpl,
  });
}
