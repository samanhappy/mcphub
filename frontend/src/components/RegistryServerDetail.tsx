import { useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import {
  RegistryServerEntry,
  RegistryPackage,
  RegistryRemote,
  RegistryServerData,
  ServerConfig,
} from '@/types';
import ServerForm from './ServerForm';

interface RegistryServerDetailProps {
  serverEntry: RegistryServerEntry;
  onBack: () => void;
  onInstall?: (server: RegistryServerData, config: ServerConfig) => void;
  installing?: boolean;
  isInstalled?: boolean;
  fetchVersions?: (serverName: string) => Promise<RegistryServerEntry[]>;
}

const RegistryServerDetail: React.FC<RegistryServerDetailProps> = ({
  serverEntry,
  onBack,
  onInstall,
  installing = false,
  isInstalled = false,
  fetchVersions,
}) => {
  const { t } = useTranslation();
  const { server, _meta } = serverEntry;

  const [_selectedVersion, _setSelectedVersion] = useState<string>(server.version);
  const [_availableVersions, setAvailableVersions] = useState<RegistryServerEntry[]>([]);
  const [_loadingVersions, setLoadingVersions] = useState(false);
  const [modalVisible, setModalVisible] = useState(false);
  const [selectedInstallType, setSelectedInstallType] = useState<'package' | 'remote' | null>(null);
  const [selectedOption, setSelectedOption] = useState<RegistryPackage | RegistryRemote | null>(
    null,
  );
  const [installError, setInstallError] = useState<string | null>(null);
  const [expandedSections, setExpandedSections] = useState<Record<string, boolean>>({
    packages: true,
    remotes: true,
    repository: true,
  });

  const officialMeta = _meta?.['io.modelcontextprotocol.registry/official'];

  // Load available versions
  useEffect(() => {
    const loadVersions = async () => {
      if (fetchVersions) {
        setLoadingVersions(true);
        try {
          const versions = await fetchVersions(server.name);
          setAvailableVersions(versions);
        } catch (error) {
          console.error('Failed to load versions:', error);
        } finally {
          setLoadingVersions(false);
        }
      }
    };

    loadVersions();
  }, [server.name, fetchVersions]);

  // Get icon to display
  const getIcon = () => {
    if (server.icons && server.icons.length > 0) {
      const lightIcon = server.icons.find((icon) => !icon.theme || icon.theme === 'light');
      return lightIcon || server.icons[0];
    }
    return null;
  };

  const icon = getIcon();

  // Format date
  const formatDate = (dateString?: string) => {
    if (!dateString) return '';
    try {
      const date = new Date(dateString);
      return date.toLocaleDateString();
    } catch {
      return '';
    }
  };

  // Toggle section expansion
  const toggleSection = (section: string) => {
    setExpandedSections((prev) => ({ ...prev, [section]: !prev[section] }));
  };

  // Handle install button click
  const handleInstallClick = (
    type: 'package' | 'remote',
    option: RegistryPackage | RegistryRemote,
  ) => {
    setSelectedInstallType(type);
    setSelectedOption(option);
    setInstallError(null);
    setModalVisible(true);
  };

  // Handle modal close
  const handleModalClose = () => {
    setModalVisible(false);
    setInstallError(null);
  };

  // Handle install submission
  const handleInstallSubmit = async (payload: any) => {
    try {
      if (!onInstall || !selectedOption || !selectedInstallType) return;

      setInstallError(null);

      // Extract the ServerConfig from the payload
      const config: ServerConfig = payload.config;

      // Call onInstall with server data and config
      onInstall(server, config);
      setModalVisible(false);
    } catch (err) {
      console.error('Error installing server:', err);
      setInstallError(t('errors.serverInstall'));
    }
  };

  // Build initial data for ServerForm
  const getInitialFormData = () => {
    if (!selectedOption || !selectedInstallType) return null;
    console.log('Building initial form data for:', selectedOption);

    if (selectedInstallType === 'package' && 'identifier' in selectedOption) {
      const pkg = selectedOption as RegistryPackage;

      // Build environment variables from package definition
      const env: Record<string, string> = {};
      if (pkg.environmentVariables) {
        pkg.environmentVariables.forEach((envVar) => {
          env[envVar.name] = envVar.default || '';
        });
      }

      const command = getCommand(pkg.registryType);
      return {
        name: server.name,
        status: 'disconnected' as const,
        config: {
          type: 'stdio' as const,
          command: command,
          args: getArgs(command, pkg),
          env: Object.keys(env).length > 0 ? env : undefined,
        },
      };
    } else if (selectedInstallType === 'remote' && 'url' in selectedOption) {
      const remote = selectedOption as RegistryRemote;

      // Build headers from remote definition
      const headers: Record<string, string> = {};
      if (remote.headers) {
        remote.headers.forEach((header) => {
          headers[header.name] = header.default || header.value || '';
        });
      }

      // Determine transport type - default to streamable-http for remotes
      const transportType = remote.type === 'sse' ? ('sse' as const) : ('streamable-http' as const);

      return {
        name: server.name,
        status: 'disconnected' as const,
        config: {
          type: transportType,
          url: remote.url,
          headers: Object.keys(headers).length > 0 ? headers : undefined,
        },
      };
    }

    return null;
  };

  // Render package option
  const renderPackage = (pkg: RegistryPackage, index: number) => {
    return (
      <div
        key={index}
        className="border border-gray-200 rounded-lg p-4 mb-3 hover:border-blue-400 transition-colors"
      >
        <div className="flex items-start justify-between mb-3">
          <div className="flex-1">
            <h4 className="font-medium text-gray-900">{pkg.identifier}</h4>
            {pkg.version && <p className="text-sm text-gray-500">Version: {pkg.version}</p>}
            {pkg.runtimeHint && <p className="text-sm text-gray-600 mt-1">{pkg.runtimeHint}</p>}
          </div>
          <button
            onClick={() => handleInstallClick('package', pkg)}
            disabled={isInstalled || installing}
            className={`px-4 py-2 rounded text-sm font-medium transition-colors ${
              isInstalled
                ? 'bg-green-600 text-white cursor-default'
                : installing
                  ? 'bg-gray-400 text-white cursor-not-allowed'
                  : 'bg-blue-600 text-white hover:bg-blue-700'
            }`}
          >
            {isInstalled
              ? t('registry.installed')
              : installing
                ? t('registry.installing')
                : t('registry.install')}
          </button>
        </div>

        {/* Package details */}
        {pkg.registryType && (
          <div className="text-sm text-gray-600 mb-2">
            <span className="font-medium">Registry:</span> {pkg.registryType}
          </div>
        )}

        {/* Transport type */}
        {pkg.transport && (
          <div className="text-sm text-gray-600 mb-2">
            <span className="font-medium">Transport:</span> {pkg.transport.type}
            {pkg.transport.url && <span className="ml-2 text-gray-500">({pkg.transport.url})</span>}
          </div>
        )}

        {/* Environment Variables */}
        {pkg.environmentVariables && pkg.environmentVariables.length > 0 && (
          <div className="mt-3 border-t border-gray-200 pt-3">
            <h5 className="text-sm font-medium text-gray-700 mb-2">
              {t('registry.environmentVariables')}:
            </h5>
            <div className="space-y-2">
              {pkg.environmentVariables.map((envVar, envIndex) => (
                <div key={envIndex} className="text-sm">
                  <div className="flex items-start">
                    <span className="font-mono text-gray-900 font-medium">{envVar.name}</span>
                    {envVar.isRequired && (
                      <span className="ml-2 inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-red-100 text-red-800">
                        {t('common.required')}
                      </span>
                    )}
                    {envVar.isSecret && (
                      <span className="ml-2 inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-yellow-100 text-yellow-800">
                        {t('common.secret')}
                      </span>
                    )}
                  </div>
                  {envVar.description && <p className="text-gray-600 mt-1">{envVar.description}</p>}
                  {envVar.default && (
                    <p className="text-gray-500 mt-1">
                      <span className="font-medium">{t('common.default')}:</span>{' '}
                      <span className="font-mono">{envVar.default}</span>
                    </p>
                  )}
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Package Arguments */}
        {pkg.packageArguments && pkg.packageArguments.length > 0 && (
          <div className="mt-3 border-t border-gray-200 pt-3">
            <h5 className="text-sm font-medium text-gray-700 mb-2">
              {t('registry.packageArguments')}:
            </h5>
            <div className="space-y-2">
              {pkg.packageArguments.map((arg, argIndex) => (
                <div key={argIndex} className="text-sm">
                  <div className="flex items-start">
                    <span className="font-mono text-gray-900 font-medium">{arg.name}</span>
                    {arg.isRequired && (
                      <span className="ml-2 inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-red-100 text-red-800">
                        {t('common.required')}
                      </span>
                    )}
                    {arg.isSecret && (
                      <span className="ml-2 inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-yellow-100 text-yellow-800">
                        {t('common.secret')}
                      </span>
                    )}
                    {arg.isRepeated && (
                      <span className="ml-2 inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-purple-100 text-purple-800">
                        {t('common.repeated')}
                      </span>
                    )}
                  </div>
                  {arg.description && <p className="text-gray-600 mt-1">{arg.description}</p>}
                  {arg.type && (
                    <p className="text-gray-500 mt-1">
                      <span className="font-medium">{t('common.type')}:</span>{' '}
                      <span className="font-mono">{arg.type}</span>
                    </p>
                  )}
                  {arg.default && (
                    <p className="text-gray-500 mt-1">
                      <span className="font-medium">{t('common.default')}:</span>{' '}
                      <span className="font-mono">{arg.default}</span>
                    </p>
                  )}
                  {arg.value && (
                    <p className="text-gray-500 mt-1">
                      <span className="font-medium">{t('common.value')}:</span>{' '}
                      <span className="font-mono">{arg.value}</span>
                    </p>
                  )}
                  {arg.valueHint && (
                    <p className="text-gray-500 mt-1">
                      <span className="font-medium">{t('common.valueHint')}:</span>{' '}
                      <span className="font-mono">{arg.valueHint}</span>
                    </p>
                  )}
                  {arg.choices && arg.choices.length > 0 && (
                    <p className="text-gray-500 mt-1">
                      <span className="font-medium">{t('common.choices')}:</span>{' '}
                      <span className="font-mono">{arg.choices.join(', ')}</span>
                    </p>
                  )}
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    );
  };

  // Render remote option
  const renderRemote = (remote: RegistryRemote, index: number) => {
    return (
      <div
        key={index}
        className="border border-gray-200 rounded-lg p-4 mb-3 hover:border-blue-400 transition-colors"
      >
        <div className="flex items-start justify-between mb-3">
          <div className="flex-1">
            <h4 className="font-medium text-gray-900">{remote.type}</h4>
            <p className="text-sm text-gray-600 mt-1 break-all">{remote.url}</p>
          </div>
          <button
            onClick={() => handleInstallClick('remote', remote)}
            disabled={isInstalled || installing}
            className={`px-4 py-2 rounded text-sm font-medium transition-colors ${
              isInstalled
                ? 'bg-green-600 text-white cursor-default'
                : installing
                  ? 'bg-gray-400 text-white cursor-not-allowed'
                  : 'bg-blue-600 text-white hover:bg-blue-700'
            }`}
          >
            {isInstalled
              ? t('registry.installed')
              : installing
                ? t('registry.installing')
                : t('registry.install')}
          </button>
        </div>

        {/* Headers */}
        {remote.headers && remote.headers.length > 0 && (
          <div className="mt-3 border-t border-gray-200 pt-3">
            <h5 className="text-sm font-medium text-gray-700 mb-2">{t('registry.headers')}:</h5>
            <div className="space-y-2">
              {remote.headers.map((header, headerIndex) => (
                <div key={headerIndex} className="text-sm">
                  <div className="flex items-start">
                    <span className="font-mono text-gray-900 font-medium">{header.name}</span>
                    {header.isRequired && (
                      <span className="ml-2 inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-red-100 text-red-800">
                        {t('common.required')}
                      </span>
                    )}
                    {header.isSecret && (
                      <span className="ml-2 inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-yellow-100 text-yellow-800">
                        {t('common.secret')}
                      </span>
                    )}
                  </div>
                  {header.description && <p className="text-gray-600 mt-1">{header.description}</p>}
                  {header.value && (
                    <p className="text-gray-500 mt-1">
                      <span className="font-medium">{t('common.value')}:</span>{' '}
                      <span className="font-mono">{header.value}</span>
                    </p>
                  )}
                  {header.default && (
                    <p className="text-gray-500 mt-1">
                      <span className="font-medium">{t('common.default')}:</span>{' '}
                      <span className="font-mono">{header.default}</span>
                    </p>
                  )}
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    );
  };

  return (
    <div className="bg-white shadow rounded-lg p-6">
      {/* Header */}
      <div className="mb-6">
        <button
          onClick={onBack}
          className="flex items-center text-blue-600 hover:text-blue-800 mb-4 transition-colors"
        >
          <svg className="w-5 h-5 mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M15 19l-7-7 7-7"
            />
          </svg>
          {t('registry.backToList')}
        </button>

        <div className="flex items-start space-x-4">
          {/* Icon */}
          {icon ? (
            <img
              src={icon.src}
              alt={server.title}
              className="w-20 h-20 rounded-lg object-cover flex-shrink-0"
              onError={(e) => {
                e.currentTarget.style.display = 'none';
              }}
            />
          ) : (
            <div className="w-20 h-20 bg-gradient-to-br from-blue-500 to-purple-600 rounded-lg flex items-center justify-center text-white text-3xl font-semibold flex-shrink-0">
              M
            </div>
          )}

          {/* Title and metadata */}
          <div className="flex-1">
            <h1 className="text-3xl font-bold text-gray-900 mb-2">{server.name}</h1>

            <div className="flex flex-wrap gap-2 mb-3">
              {officialMeta?.isLatest && (
                <span className="inline-flex items-center px-3 py-1 rounded-full text-sm font-medium bg-green-100 text-green-800">
                  {t('registry.latest')}
                </span>
              )}
              <span className="inline-flex items-center px-3 py-1 rounded-full text-sm font-medium bg-blue-100 text-blue-800">
                v{server.version}
              </span>
              {officialMeta?.status && (
                <span className="inline-flex items-center px-3 py-1 rounded-full text-sm font-medium bg-gray-100 text-gray-800">
                  {officialMeta.status}
                </span>
              )}
              {/* Dates */}
              <span className="flex flex-wrap items-center gap-4 text-sm text-gray-600">
                {officialMeta?.publishedAt && (
                  <div>
                    <span className="font-medium">{t('registry.published')}:</span>{' '}
                    {formatDate(officialMeta.publishedAt)}
                  </div>
                )}
                {officialMeta?.updatedAt && (
                  <div>
                    <span className="font-medium">{t('registry.updated')}:</span>{' '}
                    {formatDate(officialMeta.updatedAt)}
                  </div>
                )}
              </span>
            </div>
          </div>
        </div>
      </div>

      {/* Description */}
      <div className="mb-6">
        <h2 className="text-xl font-semibold text-gray-900 mb-3">{t('registry.description')}</h2>
        <p className="text-gray-700 leading-relaxed whitespace-pre-wrap">{server.description}</p>
      </div>

      {/* Website */}
      {server.websiteUrl && (
        <div className="mb-6">
          <h2 className="text-xl font-semibold text-gray-900 mb-3">{t('registry.website')}</h2>
          <a
            href={server.websiteUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="text-blue-600 hover:text-blue-800 hover:underline"
          >
            {server.websiteUrl}
          </a>
        </div>
      )}

      {/* Packages */}
      {server.packages && server.packages.length > 0 && (
        <div className="mb-6">
          <button
            onClick={() => toggleSection('packages')}
            className="flex items-center justify-between w-full text-xl font-semibold text-gray-900 mb-3 hover:text-blue-600 transition-colors"
          >
            <span>
              {t('registry.packages')} ({server.packages.length})
            </span>
            <svg
              className={`w-5 h-5 transform transition-transform ${expandedSections.packages ? 'rotate-180' : ''}`}
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M19 9l-7 7-7-7"
              />
            </svg>
          </button>
          {expandedSections.packages && (
            <div className="space-y-3">{server.packages.map(renderPackage)}</div>
          )}
        </div>
      )}

      {/* Remotes */}
      {server.remotes && server.remotes.length > 0 && (
        <div className="mb-6">
          <button
            onClick={() => toggleSection('remotes')}
            className="flex items-center justify-between w-full text-xl font-semibold text-gray-900 mb-3 hover:text-blue-600 transition-colors"
          >
            <span>
              {t('registry.remotes')} ({server.remotes.length})
            </span>
            <svg
              className={`w-5 h-5 transform transition-transform ${expandedSections.remotes ? 'rotate-180' : ''}`}
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M19 9l-7 7-7-7"
              />
            </svg>
          </button>
          {expandedSections.remotes && (
            <div className="space-y-3">{server.remotes.map(renderRemote)}</div>
          )}
        </div>
      )}

      {/* Repository */}
      {server.repository && (
        <div className="mb-6">
          <button
            onClick={() => toggleSection('repository')}
            className="flex items-center justify-between w-full text-xl font-semibold text-gray-900 mb-3 hover:text-blue-600 transition-colors"
          >
            <span>{t('registry.repository')}</span>
            <svg
              className={`w-5 h-5 transform transition-transform ${expandedSections.repository ? 'rotate-180' : ''}`}
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M19 9l-7 7-7-7"
              />
            </svg>
          </button>
          {expandedSections.repository && (
            <div className="border border-gray-200 rounded-lg p-4">
              {server.repository.url && (
                <div className="mb-2">
                  <span className="font-medium text-gray-700">URL:</span>{' '}
                  <a
                    href={server.repository.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-blue-600 hover:text-blue-800 hover:underline break-all"
                  >
                    {server.repository.url}
                  </a>
                </div>
              )}
              {server.repository.source && (
                <div className="mb-2">
                  <span className="font-medium text-gray-700">Source:</span>{' '}
                  {server.repository.source}
                </div>
              )}
              {server.repository.subfolder && (
                <div className="mb-2">
                  <span className="font-medium text-gray-700">Subfolder:</span>{' '}
                  {server.repository.subfolder}
                </div>
              )}
              {server.repository.id && (
                <div>
                  <span className="font-medium text-gray-700">ID:</span> {server.repository.id}
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {/* Install Modal */}
      {modalVisible && selectedOption && selectedInstallType && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
          <ServerForm
            onSubmit={handleInstallSubmit}
            onCancel={handleModalClose}
            modalTitle={t('registry.installServer', { name: server.title || server.name })}
            formError={installError}
            initialData={getInitialFormData()}
          />
        </div>
      )}
    </div>
  );
};

export default RegistryServerDetail;
// Helper function to determine command based on registry type
function getCommand(registryType: string): string {
  // Map registry types to appropriate commands
  switch (registryType.toLowerCase()) {
    case 'pypi':
    case 'python':
      return 'uvx';
    case 'npm':
    case 'node':
      return 'npx';
    case 'oci':
    case 'docker':
      return 'docker';
    default:
      return '';
  }
}

// Helper function to get appropriate args based on command type and package identifier
function getArgs(command: string, pkg: RegistryPackage): string[] {
  const identifier = [pkg.identifier + (pkg.version ? `@${pkg.version}` : '')];

  // Build package arguments if available
  const packageArgs: string[] = [];
  if (pkg.packageArguments && pkg.packageArguments.length > 0) {
    pkg.packageArguments.forEach((arg) => {
      // Add required arguments or arguments with default values
      if (arg.isRequired || arg.default || arg.value) {
        const argName = `--${arg.name}`;
        // Priority: value > default > placeholder
        const argValue = arg.value || arg.default || `\${${arg.name.toUpperCase()}}`;
        packageArgs.push(argName, argValue);
      }
    });
  }

  // Map commands to appropriate argument patterns
  switch (command.toLowerCase()) {
    case 'uvx':
      // For Python packages: uvx package-name --arg1 value1 --arg2 value2
      return [...identifier, ...packageArgs];
    case 'npx':
      // For Node.js packages: npx package-name --arg1 value1 --arg2 value2
      return [...identifier, ...packageArgs];
    case 'docker': {
      // add envs from environment variables if available
      const envs: string[] = [];
      if (pkg.environmentVariables) {
        pkg.environmentVariables.forEach((env) => {
          envs.push('-e', `${env.name}`);
        });
      }
      // For Docker images: docker run -i package-name --arg1 value1 --arg2 value2
      return ['run', '-i', '--rm', ...envs, ...identifier, ...packageArgs];
    }
    default:
      // If no specific pattern is defined, return identifier with package args
      return [...identifier, ...packageArgs];
  }
}
