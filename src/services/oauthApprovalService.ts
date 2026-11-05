import { createHash, randomUUID } from 'node:crypto';
import { getOAuthApprovalDao } from '../dao/index.js';
import type { IOAuthClient, OAuthClientApproval } from '../types/index.js';

export interface ApprovalUser {
  username: string;
  sessionVersion?: string;
  approvalId?: string;
  approvalContext?: { redirectUri: string; resource: string };
}

// Share the OAuth model's effective scopes with consent rendering and subset checks.
export function resolveConsentScopes(scope: string | undefined, allowedScopes: string[]): string[] {
  const requested = scope?.split(' ').filter(Boolean) ?? [];
  return [
    ...new Set(
      requested.length ? requested.filter((s) => allowedScopes.includes(s)) : allowedScopes,
    ),
  ].sort();
}

export function fingerprintOAuthClient(client: IOAuthClient): string {
  return createHash('sha256')
    .update(
      JSON.stringify({
        id: client.clientId,
        issuedAt: client.clientIdIssuedAt ?? null,
        redirects: [...client.redirectUris].sort(),
        grants: [...client.grants].sort(),
        scopes: client.scopes ? [...client.scopes].sort() : null,
        secret: client.clientSecret ?? null,
        name: client.name ?? null,
        metadata: client.metadata ?? null,
      }),
    )
    .digest('hex');
}

export async function findReusableApproval(
  user: ApprovalUser,
  client: IOAuthClient,
  redirectUri: string,
  resource: string,
  scopes: string[],
): Promise<OAuthClientApproval | undefined> {
  if (!user.sessionVersion || !scopes.length) return undefined;
  const fingerprint = fingerprintOAuthClient(client);
  return (await getOAuthApprovalDao().findByUsername(user.username)).find(
    (row) =>
      row.sessionVersion === user.sessionVersion &&
      row.clientId === client.clientId &&
      row.clientFingerprint === fingerprint &&
      row.redirectUri === redirectUri &&
      row.resource === resource &&
      Date.parse(row.expiresAt) > Date.now() &&
      scopes.every((scope) => row.scopes.includes(scope)),
  );
}

export async function rememberApproval(
  user: ApprovalUser,
  client: IOAuthClient,
  scopes: string[],
  lifetime: number,
): Promise<string> {
  const context = user.approvalContext;
  if (!user.sessionVersion || !context) throw new Error('Missing consent context');
  const existing = await findReusableApproval(
    user,
    client,
    context.redirectUri,
    context.resource,
    scopes,
  );
  // Silent authorization and refresh never extend the original consent deadline.
  if (existing) return existing.id;
  if (!Number.isSafeInteger(lifetime) || lifetime <= 0 || lifetime > 31536000) {
    throw new Error('Invalid approvalLifetime');
  }
  const now = Date.now();
  const approval: OAuthClientApproval = {
    id: randomUUID(),
    username: user.username,
    sessionVersion: user.sessionVersion,
    clientId: client.clientId,
    clientFingerprint: fingerprintOAuthClient(client),
    redirectUri: context.redirectUri,
    resource: context.resource,
    scopes,
    approvedAt: new Date(now).toISOString(),
    expiresAt: new Date(now + lifetime * 1000).toISOString(),
  };
  await getOAuthApprovalDao().save(approval);
  return approval.id;
}

// Expiration controls future silent consent only. Deletion revokes the grant,
// including tokens saved concurrently with revocation on another replica.
export async function isApprovalGrantValid(user: ApprovalUser, clientId: string): Promise<boolean> {
  if (!user.approvalId) return true; // Credentials issued before opting in retain their normal lifetime.
  const approval = await getOAuthApprovalDao().findById(user.approvalId);
  return (
    !!approval &&
    approval.username === user.username &&
    approval.clientId === clientId &&
    approval.sessionVersion === user.sessionVersion
  );
}
