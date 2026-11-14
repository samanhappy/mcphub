import type { FileStagingSettings } from '../../types/index.js';
import type { StagingPrincipal } from './identity.js';
import type { StagingStateStore } from './stateStore.js';
import { StagingError } from './types.js';

/** Virtual hub tools exposed when a route has at least one staging target. */
export const STAGING_TOOL_PREFIX = 'mcphub_file_';

export interface StagingToolTargetSummary {
  serverName: string;
  serverId: string;
  shared: boolean;
}

export interface StagingToolContext {
  targets: readonly StagingToolTargetSummary[];
  principal: StagingPrincipal;
  settings: FileStagingSettings;
  store: StagingStateStore;
  /** Mint a one-time download URL for a ready ref. */
  createDownloadUrl(ref: string): Promise<{ downloadUrl: string; expiresAt: string }>;
}

export const STAGING_TOOL_DEFINITIONS = [
  {
    name: 'mcphub_file_upload',
    title: 'Upload or reserve a staged file',
    description:
      'Stage a file for a stdio tool behind the hub. With content_base64, upload a small file and pass the returned mcpfile:// reference to a tool parameter that expects a file. Without content, reserve an empty output destination; after the tool writes it, poll mcphub_file_status and fetch it with mcphub_file_download.',
    inputSchema: {
      type: 'object',
      properties: {
        filename: {
          type: 'string',
          description: 'Display name only; never a path. Sanitized by the hub.',
        },
        content_base64: {
          type: 'string',
          description: 'Base64 file content for a small upload. Omit to reserve a tool output.',
        },
        server: {
          type: 'string',
          description: 'Staging-enabled server name; required when the route has more than one.',
        },
        allow_zero_byte: {
          type: 'boolean',
          description: 'Allow an empty tool output to become ready (default false).',
        },
      },
      required: ['filename'],
      additionalProperties: false,
    },
  },
  {
    name: 'mcphub_file_status',
    title: 'Check a staged file',
    description: 'Report the state, size, hash and expiry of a staged file reference.',
    inputSchema: {
      type: 'object',
      properties: { ref: { type: 'string', description: 'mcpfile:// reference' } },
      required: ['ref'],
      additionalProperties: false,
    },
  },
  {
    name: 'mcphub_file_download',
    title: 'Download a staged file',
    description: 'Return a short-lived one-time download URL for a ready staged file.',
    inputSchema: {
      type: 'object',
      properties: { ref: { type: 'string', description: 'mcpfile:// reference' } },
      required: ['ref'],
      additionalProperties: false,
    },
  },
] as const;

export type StagingToolName = (typeof STAGING_TOOL_DEFINITIONS)[number]['name'];

const DEFINITION_NAMES = new Set<string>(STAGING_TOOL_DEFINITIONS.map((tool) => tool.name));

export const isStagingToolName = (name: unknown): name is StagingToolName =>
  typeof name === 'string' && DEFINITION_NAMES.has(name);

export const isReservedStagingName = (name: unknown): boolean =>
  typeof name === 'string' && name.startsWith(STAGING_TOOL_PREFIX);

const ok = (payload: Record<string, unknown>) => ({
  content: [{ type: 'text' as const, text: JSON.stringify(payload) }],
});

const failure = (message: string) => ({
  isError: true,
  content: [{ type: 'text' as const, text: message }],
});

/** Public text for a ledger failure; never reveals another principal's ref. */
const messageFor = (error: unknown): string => {
  if (!(error instanceof StagingError)) return 'File staging request failed';
  switch (error.code) {
    case 'quota-exceeded':
      return 'File staging quota exceeded';
    case 'lease-conflict':
      return 'The output destination is busy; retry later';
    case 'not-ready':
      return 'The staged file is not ready';
    case 'expired':
      return 'The staged file has expired';
    case 'unauthenticated':
      return 'A signed-in user is required for file staging';
    default:
      return 'Staging reference not found';
  }
};

const sanitizeFilename = (value: unknown): string => {
  if (typeof value !== 'string') throw new StagingError('invalid-ref', 'filename is required');
  const cleaned = value
    .split('')
    .filter((char) => char !== '\u0000' && char !== '\r' && char !== '\n')
    .join('')
    .trim();
  if (!cleaned) throw new StagingError('invalid-ref', 'filename is required');
  return Buffer.byteLength(cleaned, 'utf8') > 255
    ? Buffer.from(cleaned, 'utf8').subarray(0, 255).toString('utf8')
    : cleaned;
};

const selectTarget = (
  targets: readonly StagingToolTargetSummary[],
  requested: unknown,
): StagingToolTargetSummary => {
  if (typeof requested === 'string' && requested.trim()) {
    const match = targets.find((target) => target.serverName === requested.trim());
    if (!match) throw new StagingError('server-mismatch', 'Server is not a staging target');
    return match;
  }
  if (targets.length === 1) return targets[0];
  throw new StagingError('server-mismatch', 'A server is required when the route has several');
};

export const executeStagingTool = async (
  name: StagingToolName,
  args: Record<string, unknown> | undefined,
  context: StagingToolContext,
): Promise<ReturnType<typeof ok> | ReturnType<typeof failure>> => {
  try {
    if (name === 'mcphub_file_upload') {
      const target = selectTarget(context.targets, args?.server);
      const filename = sanitizeFilename(args?.filename);
      const inline = args?.content_base64;
      const allowZeroByte = args?.allow_zero_byte === true;
      if (typeof inline === 'string' && inline.length > 0) {
        const data = Buffer.from(inline, 'base64');
        if (data.length === 0) throw new StagingError('invalid-ref', 'Invalid base64 content');
        const record = await context.store.createReadyRef(
          {
            principal: context.principal,
            serverId: target.serverId,
            serverName: target.serverName,
            filename,
            allowZeroByte,
            settings: context.settings,
          },
          data,
        );
        return ok({ ref: record.ref, state: record.state, size: record.size });
      }
      const record = await context.store.createReservedRef({
        principal: context.principal,
        serverId: target.serverId,
        serverName: target.serverName,
        filename,
        allowZeroByte,
        settings: context.settings,
      });
      return ok({ ref: record.ref, state: record.state });
    }

    if (name === 'mcphub_file_status') {
      const record = await context.store.getOwnedRef(
        String(args?.ref ?? ''),
        context.principal.ownerHash,
      );
      return ok({
        ref: record.ref,
        state: record.state,
        size: record.size,
        sha256: record.sha256,
        expiresAt: record.expiresAt,
      });
    }

    if (name === 'mcphub_file_download') {
      const record = await context.store.getOwnedRef(
        String(args?.ref ?? ''),
        context.principal.ownerHash,
      );
      if (record.state !== 'ready') throw new StagingError('not-ready', 'File is not ready');
      const { downloadUrl, expiresAt } = await context.createDownloadUrl(record.ref);
      return ok({ ref: record.ref, downloadUrl, expiresAt });
    }

    throw new StagingError('invalid-ref', 'Unknown staging tool');
  } catch (error) {
    return failure(messageFor(error));
  }
};
