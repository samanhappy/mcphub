import { invalidateListFreshness, recordListFreshness } from '../utils/listFreshness.js';
import { Client, type Tool } from './mcpSdkClient.js';
import { LEGACY_PROTOCOL_VERSIONS } from '../utils/mcpProtocol.js';

/** Keep v1's single-page discovery and output validation while using SDK v2. */
export class LegacyMcpClient extends Client {
  private readonly listVersions = new Map<string, number>();
  private readonly listSnapshots = new Map<string, object>();
  private readonly listedTools = new Map<string, Tool>();

  constructor(...[info, options]: ConstructorParameters<typeof Client>) {
    super(info, {
      ...options,
      versionNegotiation: { mode: 'legacy' },
      supportedProtocolVersions: LEGACY_PROTOCOL_VERSIONS,
      enforceStrictCapabilities: true,
    });
  }

  private async freshList<T extends { ttlMs?: number; nextCursor?: string }>(
    key: string,
    fetch: () => Promise<T>,
    snapshot: (result: T) => object,
  ): Promise<T> {
    const version = (this.listVersions.get(key) ?? 0) + 1;
    this.listVersions.set(key, version);
    const previous = this.listSnapshots.get(key);
    if (previous) invalidateListFreshness(previous);
    const startedAt = performance.now();
    const result = await fetch();
    const items = snapshot(result);
    if (this.listVersions.get(key) === version) {
      recordListFreshness(items, result.nextCursor ? undefined : result.ttlMs, startedAt);
      this.listSnapshots.set(key, items);
    }
    return result;
  }

  override async close(): Promise<void> {
    for (const snapshot of this.listSnapshots.values()) invalidateListFreshness(snapshot);
    this.listSnapshots.clear();
    for (const [key, version] of this.listVersions) this.listVersions.set(key, version + 1);
    await super.close();
  }

  override async listTools(...[params, options]: Parameters<Client['listTools']>) {
    const result = await this.freshList(
      'tools',
      () => this.request({ method: 'tools/list', params }, options),
      (result) => result.tools,
    );
    this.listedTools.clear();
    for (const tool of result.tools) this.listedTools.set(tool.name, tool);
    return result;
  }

  override listPrompts(...[params, options]: Parameters<Client['listPrompts']>) {
    return this.freshList(
      'prompts',
      () => this.request({ method: 'prompts/list', params }, options),
      (result) => result.prompts,
    );
  }

  override listResources(...[params, options]: Parameters<Client['listResources']>) {
    return this.freshList(
      'resources',
      () => this.request({ method: 'resources/list', params }, options),
      (result) => result.resources,
    );
  }

  override listResourceTemplates(
    ...[params, options]: Parameters<Client['listResourceTemplates']>
  ) {
    return this.freshList(
      'templates',
      () => this.request({ method: 'resources/templates/list', params }, options),
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
