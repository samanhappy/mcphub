import {
  recordUpstreamList,
  clearUpstreamLists,
  upstreamListOwner,
  type UpstreamList,
} from '../services/upstreamListRefresh.js';
import { invalidateListFreshness, recordListFreshness } from '../utils/listFreshness.js';
import { Client, type Tool } from './mcpSdkClient.js';
import { LEGACY_PROTOCOL_VERSIONS } from '../utils/mcpProtocol.js';

/** Keep v1's output validation and discover all upstream pages while using SDK v2. */
export class LegacyMcpClient extends Client {
  readonly [upstreamListOwner] = {};
  private readonly listVersions = new Map<string, number>();
  private readonly listSnapshots = new Map<string, object>();
  private readonly listedTools = new Map<string, Tool>();

  constructor(...[info, options]: ConstructorParameters<typeof Client>) {
    super(info, {
      ...options,
      versionNegotiation: options?.versionNegotiation ?? { mode: 'legacy' },
      supportedProtocolVersions: LEGACY_PROTOCOL_VERSIONS,
      enforceStrictCapabilities: true,
    });
  }

  private async freshList<T extends { ttlMs?: number; nextCursor?: string }>(
    key: UpstreamList,
    fetch: (cursor?: string) => Promise<T>,
    snapshot: (result: T) => unknown[],
  ): Promise<T> {
    const version = (this.listVersions.get(key) ?? 0) + 1;
    this.listVersions.set(key, version);
    const previous = this.listSnapshots.get(key);
    if (previous) invalidateListFreshness(previous);
    const startedAt = performance.now();
    recordUpstreamList(this, key, undefined, startedAt);
    const result = await fetch();
    const items = snapshot(result);
    const seen = new Set<string>();
    let cursor = result.nextCursor;
    while (cursor !== undefined) {
      if (seen.has(cursor) || seen.size >= 100) {
        throw new Error(
          `Invalid ${key} pagination: repeated cursor or more than 100 additional pages`,
        );
      }
      seen.add(cursor);
      const page = await fetch(cursor);
      items.push(...snapshot(page));
      cursor = page.nextCursor;
    }
    if (seen.size > 0) {
      result.nextCursor = undefined;
      // A page's TTL does not certify the freshness of the combined list.
      result.ttlMs = undefined;
    }
    if (this.listVersions.get(key) === version) {
      const ttl = result.nextCursor ? undefined : result.ttlMs;
      recordListFreshness(items, ttl, startedAt);
      recordUpstreamList(this, key, ttl, startedAt);
      this.listSnapshots.set(key, items);
    }
    return result;
  }

  override async close(): Promise<void> {
    clearUpstreamLists(this);
    for (const snapshot of this.listSnapshots.values()) invalidateListFreshness(snapshot);
    this.listSnapshots.clear();
    for (const [key, version] of this.listVersions) this.listVersions.set(key, version + 1);
    await super.close();
  }

  override async listTools(...[params, options]: Parameters<Client['listTools']>) {
    const result = await this.freshList(
      'tools',
      (cursor) =>
        this.request(
          { method: 'tools/list', params: cursor === undefined ? params : { ...params, cursor } },
          options,
        ),
      (result) => result.tools,
    );
    this.listedTools.clear();
    for (const tool of result.tools) this.listedTools.set(tool.name, tool);
    return result;
  }

  override listPrompts(...[params, options]: Parameters<Client['listPrompts']>) {
    return this.freshList(
      'prompts',
      (cursor) =>
        this.request(
          { method: 'prompts/list', params: cursor === undefined ? params : { ...params, cursor } },
          options,
        ),
      (result) => result.prompts,
    );
  }

  override listResources(...[params, options]: Parameters<Client['listResources']>) {
    return this.freshList(
      'resources',
      (cursor) =>
        this.request(
          {
            method: 'resources/list',
            params: cursor === undefined ? params : { ...params, cursor },
          },
          options,
        ),
      (result) => result.resources,
    );
  }

  override listResourceTemplates(
    ...[params, options]: Parameters<Client['listResourceTemplates']>
  ) {
    return this.freshList(
      'templates',
      (cursor) =>
        this.request(
          {
            method: 'resources/templates/list',
            params: cursor === undefined ? params : { ...params, cursor },
          },
          options,
        ),
      (result) => result.resourceTemplates,
    );
  }

  override callTool(...[params, options]: Parameters<Client['callTool']>) {
    return super.callTool(params, {
      ...options,
      toolDefinition: options?.toolDefinition ?? this.listedTools.get(params.name),
    });
  }
}
