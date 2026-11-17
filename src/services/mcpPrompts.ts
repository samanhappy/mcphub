import type { IGroupServerConfig, ServerInfo } from '../types/index.js';
import type { FilteredGroupServersResult } from '../types/mcpRouting.js';
import { getBuiltinPromptDao, getServerDao } from '../dao/index.js';
import { getNameSeparator } from '../config/index.js';
import { getMcpRequestGroup } from '../utils/mcpRequestGroup.js';
import {
  getGroupLookupName,
  projectNameForGroup,
  resolveNameFromGroup,
} from '../utils/mcpRouteNames.js';
import { findToolConfig } from '../utils/toolConfig.js';
import { ToolUnavailableError } from '../utils/toolUnavailableError.js';
import {
  summarizeArgumentsForLogging,
  summarizePromptForLogging,
} from '../utils/mcpRequestLogging.js';
import { formatErrorForLogging, summarizeErrorForLogging } from '../utils/serialization.js';
import { logger } from '../utils/logger.js';

interface PromptRoutingDependencies {
  getVisibleServerInfos(): ServerInfo[];
  getVisibleServerByName(name: string): ServerInfo | undefined;
  getFilteredServerInfosForGroup(group: string | undefined): Promise<FilteredGroupServersResult>;
  filterPromptsByGroup(
    group: string | undefined,
    serverName: string,
    prompts: Array<{ name: string }>,
    config?: IGroupServerConfig,
  ): Promise<Array<{ name: string }>>;
  classifyUnavailableReason(name: string): string;
}

// Normalize prompt payload to satisfy MCP ListPrompts response schema
export const normalizePromptForList = (prompt: {
  name: string;
  title?: string;
  description?: string;
  arguments?: any[];
  [key: string]: unknown;
}) => {
  return {
    ...prompt,
    name: prompt.name,
    title: prompt.title || prompt.name,
    description: prompt.description || '',
    arguments: Array.isArray(prompt.arguments) ? prompt.arguments : [],
  };
};

export const createPromptHandlers = (dependencies: PromptRoutingDependencies) => {
  const {
    getVisibleServerInfos,
    getVisibleServerByName,
    getFilteredServerInfosForGroup,
    filterPromptsByGroup,
    classifyUnavailableReason,
  } = dependencies;

  const findEnabledPromptOnServer = async (
    serverInfo: ServerInfo,
    name: string,
    allowRawName = false,
  ) => {
    if (serverInfo.status !== 'connected' || serverInfo.enabled === false) return undefined;
    const prompt = serverInfo.prompts.find(
      (item) =>
        item.name === name ||
        (allowRawName && item.name === `${serverInfo.name}${getNameSeparator()}${name}`),
    );
    if (!prompt) return undefined;
    const config = await getServerDao().findById(serverInfo.name);
    const promptConfig = findToolConfig(
      config?.prompts,
      serverInfo.name,
      prompt.name,
      serverInfo.prompts.map((item) => item.name),
    );
    return config?.enabled === false || promptConfig?.enabled === false ? undefined : prompt;
  };

  async function resolvePromptInGroup(
    group: string | undefined,
    promptName: string,
  ): Promise<{ serverInfo: ServerInfo; promptName: string } | undefined> {
    const lookupGroup = getGroupLookupName(group);
    if (!lookupGroup) {
      return undefined;
    }

    const { filteredServerInfos, serverConfigsByName } =
      await getFilteredServerInfosForGroup(lookupGroup);

    for (const serverInfo of filteredServerInfos) {
      if (serverInfo.status !== 'connected' || serverInfo.enabled === false) {
        continue;
      }

      const serverConfig = serverConfigsByName.get(serverInfo.name);
      const internalPromptName = resolveNameFromGroup(promptName, serverInfo.name, serverConfig);
      const prompt = await findEnabledPromptOnServer(serverInfo, internalPromptName);
      if (!prompt) {
        continue;
      }

      const filteredPrompts = await filterPromptsByGroup(
        lookupGroup,
        serverInfo.name,
        [prompt],
        serverConfig,
      );
      if (filteredPrompts.length === 0) {
        continue;
      }

      return { serverInfo, promptName: internalPromptName };
    }

    return undefined;
  }

  const handleGetPromptRequestImpl = async (request: any, extra: any) => {
    try {
      const { name, arguments: promptArgs } = request.params;
      const group = getMcpRequestGroup(extra);

      // Check built-in prompts first
      const builtinPrompt = !extra?.server && (await getBuiltinPromptDao().findByName(name));
      if (builtinPrompt && builtinPrompt.enabled !== false) {
        // Perform {{param}} template substitution
        let content = builtinPrompt.template;
        if (promptArgs) {
          for (const [key, value] of Object.entries(promptArgs)) {
            content = content.replace(new RegExp(`\\{\\{${key}\\}\\}`, 'g'), String(value));
          }
        }
        return {
          messages: [
            {
              role: 'user',
              content: { type: 'text', text: content },
            },
          ],
        };
      }

      let server: ServerInfo | undefined;
      let promptNameForServer = name;
      const lookupGroup = getGroupLookupName(group);
      if (extra && extra.server) {
        const candidate = getVisibleServerByName(extra.server);
        const prompt = candidate && (await findEnabledPromptOnServer(candidate, name, true));
        if (prompt) {
          server = candidate;
          promptNameForServer = prompt.name;
        }
      } else if (lookupGroup) {
        const groupPrompt = await resolvePromptInGroup(lookupGroup, name);
        if (groupPrompt) {
          server = groupPrompt.serverInfo;
          promptNameForServer = groupPrompt.promptName;
        }
      } else {
        for (const candidate of getVisibleServerInfos()) {
          const prompt = await findEnabledPromptOnServer(candidate, name);
          if (prompt) {
            server = candidate;
            promptNameForServer = prompt.name;
            break;
          }
        }
      }
      if (!server) {
        throw new ToolUnavailableError(
          `Prompt not available: ${name}`,
          classifyUnavailableReason(name),
        );
      }

      // Remove server prefix from prompt name if present
      const separator = getNameSeparator();
      const prefix = `${server.name}${separator}`;
      const cleanPromptName = promptNameForServer.startsWith(prefix)
        ? promptNameForServer.substring(prefix.length)
        : promptNameForServer;

      const promptParams = {
        name: cleanPromptName || '',
        arguments: promptArgs,
      };
      // Log the final promptParams
      logger.log('Calling getPrompt with params', {
        name: cleanPromptName || '',
        arguments: summarizeArgumentsForLogging(promptArgs),
      });
      const prompt = await server.client?.getPrompt(promptParams);
      logger.log('Received prompt', summarizePromptForLogging(prompt));
      if (!prompt) {
        throw new Error(`Prompt not found: ${cleanPromptName}`);
      }

      return prompt;
    } catch (error) {
      const unavailable =
        error instanceof ToolUnavailableError
          ? { message: error.message, reason: error.reason }
          : undefined;
      logger.error('Error handling GetPromptRequest', {
        ...summarizeErrorForLogging(error),
        ...(unavailable ? { reason: unavailable.reason } : {}),
      });
      // Surface exactly the unified message for unavailable targets (see #1103).
      const safeErrorText = unavailable ? unavailable.message : formatErrorForLogging(error);
      return {
        content: [
          {
            type: 'text',
            text: `Error: ${safeErrorText}`,
          },
        ],
        isError: true,
      };
    }
  };

  const handleListPromptsRequestImpl = async (_: any, extra: any) => {
    const group = getMcpRequestGroup(extra);
    const lookupGroup = getGroupLookupName(group);
    logger.log(`Handling ListPromptsRequest for group: ${group}`);

    // Start with built-in prompts (only enabled ones)
    const builtinPrompts = await getBuiltinPromptDao().findEnabled();
    const allPrompts: any[] = builtinPrompts.map((bp) =>
      normalizePromptForList({
        name: bp.name,
        title: bp.title,
        description: bp.description,
        arguments: bp.arguments,
      }),
    );

    const { filteredServerInfos, serverConfigsByName } =
      await getFilteredServerInfosForGroup(lookupGroup);

    for (const serverInfo of filteredServerInfos) {
      if (serverInfo.prompts && serverInfo.prompts.length > 0) {
        const groupServerConfig = serverConfigsByName.get(serverInfo.name);

        // Filter prompts based on server configuration
        const serverConfig = await getServerDao().findById(serverInfo.name);

        let enabledPrompts = serverInfo.prompts;
        if (serverConfig && serverConfig.prompts) {
          enabledPrompts = serverInfo.prompts.filter((prompt: any) => {
            const promptConfig = findToolConfig(
              serverConfig.prompts,
              serverInfo.name,
              prompt.name,
              serverInfo.prompts.map((item) => item.name),
            );
            // If prompt is not in config, it's enabled by default
            return promptConfig?.enabled !== false;
          });
        }

        enabledPrompts = await filterPromptsByGroup(
          lookupGroup,
          serverInfo.name,
          enabledPrompts,
          groupServerConfig,
        );

        // Apply custom descriptions from server configuration
        const promptsWithCustomDescriptions = enabledPrompts.map((prompt: any) => {
          const promptConfig = serverConfig?.prompts?.[prompt.name];
          return normalizePromptForList({
            ...prompt,
            name: projectNameForGroup(prompt.name, serverInfo.name, groupServerConfig),
            description: promptConfig?.description || prompt.description, // Use custom description if available
          });
        });

        allPrompts.push(...promptsWithCustomDescriptions);
      }
    }

    return {
      prompts: allPrompts,
    };
  };

  return { handleGetPromptRequestImpl, handleListPromptsRequestImpl };
};
