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
  /** Mint a one-time browser upload URL for a reserved ref. */
  createUploadUrl(
    ref: string,
    token: string,
  ): Promise<{ uploadUrl: string; expiresAt: string }>;
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
    name: 'mcphub_file_request_upload',
    title: 'Create a browser upload link',
    description:
      'Create a short-lived link for a person to upload a file from their own machine into the hub. Send the link to the user, then poll mcphub_file_status with upload_token until it is ready and pass the returned mcpfile:// reference to a tool parameter.',
    inputSchema: {
      type: 'object',
      properties: {
        filename: { type: 'string', description: 'Display name only; never a path.' },
        size_hint: {
          type: 'number',
          description: 'Expected size in bytes; rejected if the actual upload is larger.',
        },
        server: {
          type: 'string',
          description: 'Staging-enabled server name; required when the route has more than one.',
        },
      },
      required: ['filename'],
      additionalProperties: false,
    },
  },
  {
    name: 'mcphub_file_status',
    title: 'Check a staged file',
    description:
      'Report the state, size, hash and expiry of a staged file, by mcpfile:// reference or by an upload token.',
    inputSchema: {
      type: 'object',
      properties: {
        ref: { type: 'string', description: 'mcpfile:// reference' },
        upload_token: { type: 'string', description: 'Token from mcphub_file_request_upload' },
      },
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
  // A display name, never a path: drop directories so `../x` and `a/b` cannot
  // leak a traversal shape into logs, Content-Disposition, or a future adapter.
  const base = value.split(/[\\/]/).pop() ?? '';
  const cleaned = base
    .split('')
    .filter(
      (char) =>
        char !== '\u0000' &&
        char !== '\r' &&
        char !== '\n' &&
        char !== '"' &&
        char !== '\\',
    )
    .join('')
    .trim();
  if (!cleaned || cleaned === '.' || cleaned === '..') {
    throw new StagingError('invalid-ref', 'filename is required');
  }
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
      if (typeof inline === 'string' && inline.length === 0) {
        throw new StagingError(
          'invalid-ref',
          'content_base64 must not be empty; omit it to reserve an output path',
        );
      }
      if (typeof inline === 'string') {
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

    if (name === 'mcphub_file_request_upload') {
      const target = selectTarget(context.targets, args?.server);
      const filename = sanitizeFilename(args?.filename);
      const sizeHint = args?.size_hint;
      if (sizeHint !== undefined) {
        if (
          typeof sizeHint !== 'number' ||
          !Number.isFinite(sizeHint) ||
          sizeHint <= 0 ||
          sizeHint > context.settings.maxFileBytes
        ) {
          throw new StagingError('quota-exceeded', 'size_hint exceeds the staging limit');
        }
      }
      const record = await context.store.createReservedRef({
        principal: context.principal,
        serverId: target.serverId,
        serverName: target.serverName,
        filename,
        allowZeroByte: false,
        settings: context.settings,
      });
      const token = await context.store.createUploadToken(
        record.ref,
        context.principal.ownerHash,
        context.settings.uploadTtlSeconds,
      );
      const { uploadUrl, expiresAt } = await context.createUploadUrl(record.ref, token);
      return ok({
        ref: record.ref,
        state: record.state,
        uploadUrl,
        uploadToken: token,
        expiresAt,
        maxBytes: Math.min(
          context.settings.maxFileBytes,
          typeof sizeHint === 'number' ? sizeHint : context.settings.maxFileBytes,
        ),
      });
    }

    if (name === 'mcphub_file_status') {
      const token = args?.upload_token;
      let ref = String(args?.ref ?? '');
      if (!ref && typeof token === 'string' && token) {
        const request = await context.store.getUploadToken(token);
        ref = request.ref;
      }
      const record = await context.store.getOwnedRef(ref, context.principal.ownerHash);
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
