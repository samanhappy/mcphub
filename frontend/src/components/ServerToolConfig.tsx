import React, { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { IGroupServerConfig, Prompt, Resource, Server, Tool } from '@/types';
import { Wrench, MessageSquare, FileText } from 'lucide-react';
import { cn } from '@/utils/cn';
import { useSettingsData } from '@/hooks/useSettingsData';

type CapabilityKey = 'tools' | 'prompts' | 'resources';

const EMPTY_SELECTIONS: Pick<IGroupServerConfig, CapabilityKey> = {
  tools: [],
  prompts: [],
  resources: [],
};

const FULL_SELECTIONS: Pick<IGroupServerConfig, CapabilityKey> = {
  tools: 'all',
  prompts: 'all',
  resources: 'all',
};

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
  const { nameSeparator } = useSettingsData();
  const [expandedServers, setExpandedServers] = useState<Set<string>>(new Set());

  // Normalize current value to IGroupServerConfig[] format
  const normalizedValue: IGroupServerConfig[] = React.useMemo(() => {
    return value.map(item => {
      if (typeof item === 'string') {
        return { name: item, ...FULL_SELECTIONS };
      }
      return {
        ...item,
        tools: item.tools || 'all',
        prompts: item.prompts || 'all',
        resources: item.resources || 'all',
      };
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
      // Remove server - this also removes all capability selections
      const newValue = normalizedValue.filter(config => config.name !== serverName);
      onChange(newValue);
    } else {
      // Add server with all capabilities by default
      const newValue = [...normalizedValue, { name: serverName, ...FULL_SELECTIONS }];
      onChange(newValue);
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

  const hasAnyCapabilitySelection = (config: IGroupServerConfig) => {
    return (['tools', 'prompts', 'resources'] as CapabilityKey[]).some((capability) => {
      const selection = config[capability];
      return selection === 'all' || (Array.isArray(selection) && selection.length > 0);
    });
  };

  const updateServerCapability = (
    serverName: string,
    capability: CapabilityKey,
    selection: string[] | 'all',
    keepExpanded = false,
  ) => {
    const existingServer = normalizedValue.find(config => config.name === serverName);
    const baseConfig: IGroupServerConfig = existingServer
      ? { ...existingServer }
      : { name: serverName, ...EMPTY_SELECTIONS };
    const nextConfig: IGroupServerConfig = {
      ...baseConfig,
      [capability]: selection,
    };

    if (!hasAnyCapabilitySelection(nextConfig)) {
      const newValue = normalizedValue.filter(config => config.name !== serverName);
      onChange(newValue);
      if (!keepExpanded) {
        setExpandedServers(prev => {
          const newSet = new Set(prev);
          newSet.delete(serverName);
          return newSet;
        });
      }
      return;
    }

    if (existingServer) {
      onChange(normalizedValue.map(config => (config.name === serverName ? nextConfig : config)));
      return;
    }

    onChange([...normalizedValue, nextConfig]);
  };

  const normalizeNamedCapability = (serverName: string, name: string) => {
    const prefix = `${serverName}${nameSeparator}`;
    return name.startsWith(prefix) ? name.slice(prefix.length) : name;
  };

  const getCapabilityItems = (server: Server, capability: CapabilityKey) => {
    if (capability === 'tools') {
      return (server.tools || []).filter(tool => tool.enabled !== false).map((tool: Tool) => ({
        key: tool.name,
        value: normalizeNamedCapability(server.name, tool.name),
        description: tool.description,
      }));
    }

    if (capability === 'prompts') {
      return (server.prompts || []).filter(prompt => prompt.enabled !== false).map((prompt: Prompt) => ({
        key: prompt.name,
        value: normalizeNamedCapability(server.name, prompt.name),
        description: prompt.description,
      }));
    }

    return (server.resources || []).filter(resource => resource.enabled !== false).map((resource: Resource) => ({
      key: resource.uri,
      value: resource.uri,
      description: resource.description,
    }));
  };

  const toggleCapabilityItem = (serverName: string, capability: CapabilityKey, itemValue: string) => {
    const server = availableServers.find(s => s.name === serverName);
    if (!server) return;

    const allItems = getCapabilityItems(server, capability).map(item => item.value);
    const serverConfig = normalizedValue.find(config => config.name === serverName);

    if (!serverConfig) {
      updateServerCapability(serverName, capability, [itemValue]);
      return;
    }

    const currentSelection = serverConfig[capability];
    if (currentSelection === 'all') {
      const nextSelection = allItems.filter(value => value !== itemValue);
      updateServerCapability(serverName, capability, nextSelection);
      return;
    }

    if (Array.isArray(currentSelection)) {
      if (currentSelection.includes(itemValue)) {
        updateServerCapability(
          serverName,
          capability,
          currentSelection.filter(value => value !== itemValue),
        );
        return;
      }

      const nextSelection = [...currentSelection, itemValue];
      updateServerCapability(
        serverName,
        capability,
        nextSelection.length === allItems.length ? 'all' : nextSelection,
      );
      return;
    }

    updateServerCapability(serverName, capability, [itemValue]);
  };

  const isServerSelected = (serverName: string) => {
    const serverConfig = normalizedValue.find(config => config.name === serverName);
    return Boolean(serverConfig && hasAnyCapabilitySelection(serverConfig));
  };

  const isServerPartiallySelected = (serverName: string) => {
    const serverConfig = normalizedValue.find(config => config.name === serverName);
    if (!serverConfig) return false;

    return (['tools', 'prompts', 'resources'] as CapabilityKey[]).some((capability) => {
      const selection = serverConfig[capability];
      return Array.isArray(selection) && selection.length > 0;
    });
  };

  const isCapabilityItemSelected = (serverName: string, capability: CapabilityKey, itemValue: string) => {
    const serverConfig = normalizedValue.find(config => config.name === serverName);
    if (!serverConfig) return false;

    const selection = serverConfig[capability];
    if (selection === 'all') return true;
    return Array.isArray(selection) ? selection.includes(itemValue) : false;
  };

  const getSelectedCapabilityCount = (server: Server, capability: CapabilityKey) => {
    const serverConfig = normalizedValue.find(config => config.name === server.name);
    if (!serverConfig) return 0;

    const items = getCapabilityItems(server, capability);
    const selection = serverConfig[capability];
    if (selection === 'all') return items.length;
    if (Array.isArray(selection)) {
      const itemSet = new Set(items.map(item => item.value));
      return selection.filter(item => itemSet.has(item)).length;
    }
    return 0;
  };

  const capabilityConfigs: Array<{ key: CapabilityKey; titleKey: string; countKey: string; allKey: string }> = [
    { key: 'tools', titleKey: 'groups.toolSelection', countKey: 'groups.toolsSelected', allKey: 'groups.allTools' },
    { key: 'prompts', titleKey: 'groups.promptSelection', countKey: 'groups.promptsSelected', allKey: 'groups.allPrompts' },
    { key: 'resources', titleKey: 'groups.resourceSelection', countKey: 'groups.resourcesSelected', allKey: 'groups.allResources' },
  ];

  const getServerSummaryBadges = (server: Server) => {
    return capabilityConfigs
      .map(({ key }) => ({ key, count: getSelectedCapabilityCount(server, key) }))
      .filter((entry) => entry.count > 0);
  };

  return (
    <div className={cn("space-y-4", className)}>
      <div className="space-y-3">
        {availableServers.map(server => {
          const isSelected = isServerSelected(server.name);
          const isPartiallySelected = isServerPartiallySelected(server.name);
          const isExpanded = expandedServers.has(server.name);
          const serverConfig = normalizedValue.find(config => config.name === server.name);
          const summaryBadges = getServerSummaryBadges(server);
          const serverCapabilities = capabilityConfigs.filter(({ key }) => getCapabilityItems(server, key).length > 0);

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
                  {summaryBadges.map(({ key, count }) => (
                    <span key={key} className="text-sm text-green-600 flex items-center gap-1">
                      {key === 'tools' ? <Wrench size={14} /> : key === 'prompts' ? <MessageSquare size={14} /> : <FileText size={14} />} {count}
                    </span>
                  ))}

                  {serverCapabilities.length > 0 && (
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

              {isExpanded && serverCapabilities.length > 0 && (
                <div className="border-t border-gray-200 bg-gray-50 p-3">
                  <div className="space-y-4">
                    {serverCapabilities.map(({ key, titleKey, countKey, allKey }) => {
                      const items = getCapabilityItems(server, key);
                      const selectedCount = getSelectedCapabilityCount(server, key);
                      const allSelected = serverConfig?.[key] === 'all' || selectedCount === items.length;

                      return (
                        <div key={key}>
                          <div className="flex items-center justify-between mb-3">
                            <span className="text-sm font-medium text-gray-700">
                              {t(titleKey)}
                            </span>
                            <div className="flex items-center gap-3">
                              {serverConfig && (
                                <span className="text-xs text-green-600">
                                  {allSelected
                                    ? `(${t(allKey)} ${items.length}/${items.length})`
                                    : `(${t(countKey)} ${selectedCount}/${items.length})`}
                                </span>
                              )}
                              <button
                                type="button"
                                onClick={() => {
                                  updateServerCapability(
                                    server.name,
                                    key,
                                    allSelected ? [] : 'all',
                                    true,
                                  );
                                }}
                                className="text-sm text-blue-600 hover:text-blue-800 transition-colors"
                              >
                                {allSelected ? t('groups.selectNone') : t('groups.selectAll')}
                              </button>
                            </div>
                          </div>

                          <div className="grid grid-cols-1 gap-2 max-h-32 overflow-y-auto">
                            {items.map(item => {
                              const isChecked = isCapabilityItemSelected(server.name, key, item.value);

                              return (
                                <label key={item.key} className="flex items-center space-x-2 text-sm">
                                  <input
                                    type="checkbox"
                                    checked={isChecked}
                                    onChange={() => toggleCapabilityItem(server.name, key, item.value)}
                                    className="w-3 h-3 text-blue-600 bg-gray-100 border-gray-300 rounded focus:ring-blue-500"
                                  />
                                  <span className="text-gray-700 break-all whitespace-nowrap">
                                    {item.value}
                                  </span>
                                  {item.description && (
                                    <span className="text-gray-400 text-xs truncate">
                                      {item.description}
                                    </span>
                                  )}
                                </label>
                              );
                            })}
                          </div>
                        </div>
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
