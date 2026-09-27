import { Client, type Tool } from '@modelcontextprotocol/client';
import { LEGACY_PROTOCOL_VERSIONS } from '../utils/mcpProtocol.js';

/** Keep v1's single-page discovery and output validation while using SDK v2. */
export class LegacyMcpClient extends Client {
  private readonly listedTools = new Map<string, Tool>();

  constructor(...[info, options]: ConstructorParameters<typeof Client>) {
    super(info, {
      ...options,
      versionNegotiation: { mode: 'legacy' },
      supportedProtocolVersions: LEGACY_PROTOCOL_VERSIONS,
      enforceStrictCapabilities: true,
    });
  }

  override async listTools(...[params, options]: Parameters<Client['listTools']>) {
    const result = await this.request({ method: 'tools/list', params }, options);
    this.listedTools.clear();
    for (const tool of result.tools) this.listedTools.set(tool.name, tool);
    return result;
  }

  override listPrompts(...[params, options]: Parameters<Client['listPrompts']>) {
    return this.request({ method: 'prompts/list', params }, options);
  }

  override listResources(...[params, options]: Parameters<Client['listResources']>) {
    return this.request({ method: 'resources/list', params }, options);
  }

  override listResourceTemplates(
    ...[params, options]: Parameters<Client['listResourceTemplates']>
  ) {
    return this.request({ method: 'resources/templates/list', params }, options);
  }

  override callTool(...[params, options]: Parameters<Client['callTool']>) {
    return super.callTool(params, {
      ...options,
      toolDefinition: options?.toolDefinition ?? this.listedTools.get(params.name),
    });
  }
}
