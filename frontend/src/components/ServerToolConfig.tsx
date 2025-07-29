import React, { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { IGroupServerConfig, Server, Tool } from '@/types';
import { cn } from '@/utils/cn';

interface ServerToolConfigProps {
  servers: Server[];
  value: string[] | IGroupServerConfig[];
  onChange: (value: IGroupServerConfig[]) => void;
  className?: string;
}

export const ServerToolConfig: React.FC<ServerToolConfigProps> = ({
  servers,
  value,
  onChange,
  className
}) => {
  const { t } = useTranslation();
  const [expandedServers, setExpandedServers] = useState<Set<string>>(new Set());

  // Normalize current value to IGroupServerConfig[] format
  const normalizedValue: IGroupServerConfig[] = React.useMemo(() => {
    return value.map(item => {
      if (typeof item === 'string') {
        return { name: item, tools: 'all' as const };
      }
      return { ...item, tools: item.tools || 'all' as const };
    });
  }, [value]);

  // Get available servers (enabled only)
  const availableServers = React.useMemo(() =>
    servers.filter(server => server.enabled !== false),
    [servers]
  );

  // Clean up expanded servers when servers are removed from configuration
  // But keep servers that were explicitly expanded even if they have no configuration
  React.useEffect(() => {
    const configuredServerNames = new Set(normalizedValue.map(config => config.name));
    const availableServerNames = new Set(availableServers.map(server => server.name));

    setExpandedServers(prev => {
      const newSet = new Set<string>();
      prev.forEach(serverName => {
        // Keep expanded if server is configured OR if server exists and user manually expanded it
        if (configuredServerNames.has(serverName) || availableServerNames.has(serverName)) {
          newSet.add(serverName);
        }
      });
      return newSet;
    });
  }, [normalizedValue, availableServers]);

  const toggleServer = (serverName: string) => {
    const existingIndex = normalizedValue.findIndex(config => config.name === serverName);

    if (existingIndex >= 0) {
      // Remove server - this will also remove all its tools
      const newValue = normalizedValue.filter(config => config.name !== serverName);
      onChange(newValue);
      // Don't auto-collapse the server when it's unchecked - let user control expansion manually
    } else {
      // Add server with all tools by default
      const newValue = [...normalizedValue, { name: serverName, tools: 'all' as const }];
      onChange(newValue);
      // Don't auto-expand the server when it's checked - let user control expansion manually
    }
  };

  const toggleServerExpanded = (serverName: string) => {
    setExpandedServers(prev => {
      const newSet = new Set(prev);
      if (newSet.has(serverName)) {
        newSet.delete(serverName);
      } else {
        newSet.add(serverName);
      }
      return newSet;
    });
  };

  const updateServerTools = (serverName: string, tools: string[] | 'all', keepExpanded = false) => {
    if (Array.isArray(tools) && tools.length === 0) {
      // If no tools are selected, remove the server entirely
      const newValue = normalizedValue.filter(config => config.name !== serverName);
      onChange(newValue);
      // Only collapse the server if not explicitly asked to keep it expanded
      if (!keepExpanded) {
        setExpandedServers(prev => {
          const newSet = new Set(prev);
          newSet.delete(serverName);
          return newSet;
        });
      }
    } else {
      // Update server tools or add server if it doesn't exist
      const existingServerIndex = normalizedValue.findIndex(config => config.name === serverName);

      if (existingServerIndex >= 0) {
        // Update existing server
        const newValue = normalizedValue.map(config =>
          config.name === serverName ? { ...config, tools } : config
        );
        onChange(newValue);
      } else {
        // Add new server with specified tools
        const newValue = [...normalizedValue, { name: serverName, tools }];
        onChange(newValue);
      }
    }
  };

  const toggleTool = (serverName: string, toolName: string) => {
    const server = availableServers.find(s => s.name === serverName);
    if (!server) return;

    const allToolNames = server.tools?.map(tool => tool.name.replace(`${serverName}-`, '')) || [];
    const serverConfig = normalizedValue.find(config => config.name === serverName);

    if (!serverConfig) {
      // Server not selected yet, add it with only this tool
      const newValue = [...normalizedValue, { name: serverName, tools: [toolName] }];
      onChange(newValue);
      // Don't auto-expand - let user control expansion manually
      return;
    }

    if (serverConfig.tools === 'all') {
      // Switch from 'all' to specific tools, excluding the toggled tool
      const newTools = allToolNames.filter(name => name !== toolName);
      updateServerTools(serverName, newTools);
      // If all tools are deselected, the server will be removed and collapsed in updateServerTools
    } else if (Array.isArray(serverConfig.tools)) {
      const currentTools = serverConfig.tools;
      if (currentTools.includes(toolName)) {
        // Remove tool
        const newTools = currentTools.filter(name => name !== toolName);
        updateServerTools(serverName, newTools);
        // If all tools are deselected, the server will be removed and collapsed in updateServerTools
      } else {
        // Add tool
        const newTools = [...currentTools, toolName];

        // If all tools are selected, switch to 'all'
        if (newTools.length === allToolNames.length) {
          updateServerTools(serverName, 'all');
        } else {
          updateServerTools(serverName, newTools);
        }
      }
    }
  };

  const isServerSelected = (serverName: string) => {
    const serverConfig = normalizedValue.find(config => config.name === serverName);
    if (!serverConfig) return false;

    // Server is considered "fully selected" if tools is 'all'
    return serverConfig.tools === 'all';
  };

  const isServerPartiallySelected = (serverName: string) => {
    const serverConfig = normalizedValue.find(config => config.name === serverName);
    if (!serverConfig) return false;

    // Server is partially selected if it has specific tools selected (not 'all' and not empty)
    return Array.isArray(serverConfig.tools) && serverConfig.tools.length > 0;
  };

  const isToolSelected = (serverName: string, toolName: string) => {
    const serverConfig = normalizedValue.find(config => config.name === serverName);
    if (!serverConfig) return false;

    if (serverConfig.tools === 'all') return true;
    if (Array.isArray(serverConfig.tools)) {
      return serverConfig.tools.includes(toolName);
    }
    return false;
  };

  const getServerTools = (serverName: string): Tool[] => {
    const server = availableServers.find(s => s.name === serverName);
    return server?.tools || [];
  };

  return (
    <div className={cn("space-y-4", className)}>
      <div className="space-y-3">
        {availableServers.map(server => {
          const isSelected = isServerSelected(server.name);
          const isPartiallySelected = isServerPartiallySelected(server.name);
          const isExpanded = expandedServers.has(server.name);
          const serverTools = getServerTools(server.name);
          const serverConfig = normalizedValue.find(config => config.name === server.name);

          return (
            <div key={server.name} className="border border-gray-200 rounded-lg hover:border-gray-300 hover:bg-gray-50 transition-colors">
              <div
                className="flex items-center justify-between p-3 cursor-pointer rounded-lg transition-colors"
                onClick={() => toggleServerExpanded(server.name)}
              >
                <div
                  className="flex items-center space-x-3"
                  onClick={(e) => {
                    e.stopPropagation();
                    toggleServer(server.name);
                  }}
                >
                  <input
                    type="checkbox"
                    checked={isSelected || isPartiallySelected}
                    onChange={() => toggleServer(server.name)}
                    className="w-4 h-4 text-blue-600 bg-gray-100 border-gray-300 rounded focus:ring-blue-500"
                  />
                  <span className="font-medium text-gray-900 cursor-pointer select-none">
                    {server.name}
                  </span>
                </div>

                <div className="flex items-center space-x-3">
                  {serverConfig && serverConfig.tools !== 'all' && Array.isArray(serverConfig.tools) && (
                    <span className="text-sm text-green-600">
                      ({t('groups.toolsSelected')} {serverConfig.tools.length}/{serverTools.length})
                    </span>
                  )}
                  {serverConfig && serverConfig.tools === 'all' && (
                    <span className="text-sm text-green-600">
                      ({t('groups.allTools')} {serverTools.length}/{serverTools.length})
                    </span>
                  )}

                  {serverTools.length > 0 && (
                    <button
                      type="button"
                      className="p-1 text-gray-400 hover:text-gray-600 transition-colors"
                    >
                      <svg
                        className={cn("w-5 h-5 transition-transform", isExpanded && "rotate-180")}
                        fill="none"
                        stroke="currentColor"
                        viewBox="0 0 24 24"
                      >
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                      </svg>
                    </button>
                  )}
                </div>
              </div>

              {isExpanded && serverTools.length > 0 && (
                <div className="border-t border-gray-200 bg-gray-50 p-3">
                  <div className="flex items-center justify-between mb-3">
                    <span className="text-sm font-medium text-gray-700">
                      {t('groups.toolSelection')}
                    </span>
                    <button
                      type="button"
                      onClick={() => {
                        const isAllSelected = serverConfig?.tools === 'all';
                        if (isAllSelected || (Array.isArray(serverConfig?.tools) && serverConfig.tools.length === serverTools.length)) {
                          // If all tools are selected, deselect all (remove server) but keep expanded
                          updateServerTools(server.name, [], true);
                        } else {
                          // Select all tools (add server if not present)
                          updateServerTools(server.name, 'all');
                          // Don't auto-expand - let user control expansion manually
                        }
                      }}
                      className="text-sm text-blue-600 hover:text-blue-800 transition-colors"
                    >
                      {(serverConfig?.tools === 'all' ||
                        (Array.isArray(serverConfig?.tools) && serverConfig.tools.length === serverTools.length))
                        ? t('groups.selectNone')
                        : t('groups.selectAll')}
                    </button>
                  </div>

                  <div className="grid grid-cols-1 gap-2 max-h-32 overflow-y-auto">
                    {serverTools.map(tool => {
                      const toolName = tool.name.replace(`${server.name}-`, '');
                      const isToolChecked = isToolSelected(server.name, toolName);

                      return (
                        <label key={tool.name} className="flex items-center space-x-2 text-sm">
                          <input
                            type="checkbox"
                            checked={isToolChecked}
                            onChange={() => toggleTool(server.name, toolName)}
                            className="w-3 h-3 text-blue-600 bg-gray-100 border-gray-300 rounded focus:ring-blue-500"
                          />
                          <span className="text-gray-700">
                            {toolName}
                          </span>
                          {tool.description && (
                            <span className="text-gray-400 text-xs truncate">
                              {tool.description}
                            </span>
                          )}
                        </label>
                      );
                    })}
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </div>

      {availableServers.length === 0 && (
        <p className="text-gray-500 text-sm">{t('groups.noServerOptions')}</p>
      )}
    </div>
  );
};
