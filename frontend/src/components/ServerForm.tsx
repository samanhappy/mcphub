import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { X } from 'lucide-react';
import { Server, EnvVar, ServerFormData } from '@/types';
import { buildServerPayload } from '../utils/serverFormPayload';

interface ServerFormProps {
  onSubmit: (payload: any) => void;
  onCancel: () => void;
  initialData?: Server | null;
  modalTitle: string;
  formError?: string | null;
}

const ServerForm = ({
  onSubmit,
  onCancel,
  initialData = null,
  modalTitle,
  formError = null,
}: ServerFormProps) => {
  const { t } = useTranslation();

  // Determine the initial server type from the initialData
  const getInitialServerType = () => {
    if (!initialData || !initialData.config) return 'stdio';

    if (initialData.config.type) {
      return initialData.config.type; // Use explicit type if available
    } else if (initialData.config.url) {
      return 'sse'; // Fallback to SSE if URL exists
    } else {
      return 'stdio'; // Default to stdio
    }
  };

  const getInitialServerEnvVars = (data: Server | null): EnvVar[] => {
    if (!data || !data.config || !data.config.env) return [];

    return Object.entries(data.config.env).map(([key, value]) => ({
      key,
      value,
      description: '', // You can set a default description if needed
    }));
  };

  const getInitialOAuthConfig = (data: Server | null): ServerFormData['oauth'] => {
    const oauth = data?.config?.oauth;
    return {
      clientId: oauth?.clientId || '',
      clientSecret: oauth?.clientSecret || '',
      scopes: oauth?.scopes ? oauth.scopes.join(' ') : '',
      accessToken: oauth?.accessToken || '',
      refreshToken: oauth?.refreshToken || '',
      authorizationEndpoint: oauth?.authorizationEndpoint || '',
      tokenEndpoint: oauth?.tokenEndpoint || '',
      resource: oauth?.resource || '',
    };
  };

  const [serverType, setServerType] = useState<'stdio' | 'sse' | 'streamable-http' | 'openapi'>(
    getInitialServerType(),
  );

  const [formData, setFormData] = useState<ServerFormData>({
    name: (initialData && initialData.name) || '',
    description: (initialData && initialData.config && initialData.config.description) || '',
    url: (initialData && initialData.config && initialData.config.url) || '',
    command: (initialData && initialData.config && initialData.config.command) || '',
    arguments:
      initialData && initialData.config && initialData.config.args
        ? Array.isArray(initialData.config.args)
          ? initialData.config.args.join(' ')
          : String(initialData.config.args)
        : '',
    args: (initialData && initialData.config && initialData.config.args) || [],
    type: getInitialServerType(), // Initialize the type field
    env: getInitialServerEnvVars(initialData),
    headers: [],
    passthroughHeaders:
      initialData?.config?.passthroughHeaders?.join(', ') || '',
    visibility: (initialData?.config?.visibility ?? 'private') as
      | 'private'
      | 'group'
      | 'public',
    options: {
      timeout:
        (initialData &&
          initialData.config &&
          initialData.config.options &&
          initialData.config.options.timeout) ||
        60000,
      resetTimeoutOnProgress:
        initialData?.config?.options?.resetTimeoutOnProgress ?? true,
      maxTotalTimeout:
        (initialData &&
          initialData.config &&
          initialData.config.options &&
          initialData.config.options.maxTotalTimeout) ||
        undefined,
    },
    oauth: getInitialOAuthConfig(initialData),
    // KeepAlive configuration initialization
    keepAlive: {
      enabled: initialData?.config?.enableKeepAlive === true,
      interval: initialData?.config?.keepAliveInterval || 60000,
    },
    // OpenAPI configuration initialization
    openapi:
      initialData && initialData.config && initialData.config.openapi
        ? {
            url: initialData.config.openapi.url || '',
            schema: initialData.config.openapi.schema
              ? JSON.stringify(initialData.config.openapi.schema, null, 2)
              : '',
            inputMode: initialData.config.openapi.url
              ? 'url'
              : initialData.config.openapi.schema
                ? 'schema'
                : 'url',
            version: initialData.config.openapi.version || '3.1.0',
            securityType: initialData.config.openapi.security?.type || 'none',
            // API Key initialization
            apiKeyName: initialData.config.openapi.security?.apiKey?.name || '',
            apiKeyIn: initialData.config.openapi.security?.apiKey?.in || 'header',
            apiKeyValue: initialData.config.openapi.security?.apiKey?.value || '',
            // HTTP auth initialization
            httpScheme: initialData.config.openapi.security?.http?.scheme || 'bearer',
            httpCredentials: initialData.config.openapi.security?.http?.credentials || '',
            // OAuth2 initialization
            oauth2TokenUrl: initialData.config.openapi.security?.oauth2?.tokenUrl || '',
            oauth2ClientId: initialData.config.openapi.security?.oauth2?.clientId || '',
            oauth2ClientSecret: initialData.config.openapi.security?.oauth2?.clientSecret || '',
            oauth2Token: initialData.config.openapi.security?.oauth2?.token || '',
            // OpenID Connect initialization
            openIdConnectUrl: initialData.config.openapi.security?.openIdConnect?.url || '',
            openIdConnectToken: initialData.config.openapi.security?.openIdConnect?.token || '',
            // Passthrough headers initialization
            passthroughHeaders: initialData.config.openapi.passthroughHeaders
              ? initialData.config.openapi.passthroughHeaders.join(', ')
              : '',
          }
        : {
            inputMode: 'url',
            url: '',
            schema: '',
            version: '3.1.0',
            securityType: 'none',
            passthroughHeaders: '',
          },
  });

  const [envVars, setEnvVars] = useState<EnvVar[]>(
    initialData && initialData.config && initialData.config.env
      ? Object.entries(initialData.config.env).map(([key, value]) => ({ key, value }))
      : [],
  );

  const [headerVars, setHeaderVars] = useState<EnvVar[]>(
    initialData && initialData.config && initialData.config.headers
      ? Object.entries(initialData.config.headers).map(([key, value]) => ({ key, value }))
      : [],
  );

  const [isRequestOptionsExpanded, setIsRequestOptionsExpanded] = useState<boolean>(false);
  const [isOAuthSectionExpanded, setIsOAuthSectionExpanded] = useState<boolean>(false);
  const [isKeepAliveSectionExpanded, setIsKeepAliveSectionExpanded] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);
  const isEdit = !!initialData;

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const { name, value } = e.target;
    setFormData({ ...formData, [name]: value });
  };

  // Transform space-separated arguments string into array
  const handleArgsChange = (value: string) => {
    const args = value.split(' ').filter((arg) => arg.trim() !== '');
    setFormData({ ...formData, arguments: value, args });
  };

  const updateServerType = (type: 'stdio' | 'sse' | 'streamable-http' | 'openapi') => {
    setServerType(type);
    setFormData((prev) => ({ ...prev, type }));
  };

  const handleEnvVarChange = (index: number, field: 'key' | 'value', value: string) => {
    const newEnvVars = [...envVars];
    newEnvVars[index][field] = value;
    setEnvVars(newEnvVars);
  };

  const addEnvVar = () => {
    setEnvVars([...envVars, { key: '', value: '' }]);
  };

  const removeEnvVar = (index: number) => {
    const newEnvVars = [...envVars];
    newEnvVars.splice(index, 1);
    setEnvVars(newEnvVars);
  };

  const handleHeaderVarChange = (index: number, field: 'key' | 'value', value: string) => {
    const newHeaderVars = [...headerVars];
    newHeaderVars[index][field] = value;
    setHeaderVars(newHeaderVars);
  };

  const addHeaderVar = () => {
    setHeaderVars([...headerVars, { key: '', value: '' }]);
  };

  const removeHeaderVar = (index: number) => {
    const newHeaderVars = [...headerVars];
    newHeaderVars.splice(index, 1);
    setHeaderVars(newHeaderVars);
  };

  const handleOAuthChange = <K extends keyof NonNullable<ServerFormData['oauth']>>(
    field: K,
    value: string,
  ) => {
    setFormData((prev) => ({
      ...prev,
      oauth: {
        ...(prev.oauth || {}),
        [field]: value,
      },
    }));
  };

  // Handle options changes
  const handleOptionsChange = (
    field: 'timeout' | 'resetTimeoutOnProgress' | 'maxTotalTimeout',
    value: number | boolean | undefined,
  ) => {
    setFormData((prev) => ({
      ...prev,
      options: {
        ...prev.options,
        [field]: value,
      },
    }));
  };

  // Submit handler for server configuration
  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    try {
      const payload = buildServerPayload({
        formData,
        serverType,
        envVars,
        headerVars,
      });

      onSubmit(payload);
    } catch (err) {
      setError(`Error: ${err instanceof Error ? err.message : String(err)}`);
    }
  };

  return (
    <div className="hub-card p-6 w-full max-w-3xl max-h-screen overflow-y-auto">
      <div className="flex justify-between items-center mb-5">
        <h2 className="text-lg font-semibold text-[var(--hub-ink)]">{modalTitle}</h2>
        <button
          onClick={onCancel}
          className="hub-icon-btn"
          aria-label="Close"
        >
          <X size={16} />
        </button>
      </div>

      {(error || formError) && (
        <div className="bg-red-50 text-red-700 p-3 rounded mb-4">{formError || error}</div>
      )}

      <form onSubmit={handleSubmit}>
        <div className="mb-4">
          <label className="block text-sm font-medium mb-1.5 text-[var(--hub-ink-2)]" htmlFor="name">
            {t('server.name')}
          </label>
          <input
            type="text"
            name="name"
            id="name"
            value={formData.name}
            onChange={handleInputChange}
            className="w-full py-2 px-3 form-input"
            placeholder="e.g.: time-mcp"
            required
          />
        </div>

        <div className="mb-4">
          <label className="block text-sm font-medium mb-1.5 text-[var(--hub-ink-2)]" htmlFor="description">
            {t('server.description')}
          </label>
          <input
            type="text"
            name="description"
            id="description"
            value={formData.description || ''}
            onChange={handleInputChange}
            className="w-full py-2 px-3 form-input"
            placeholder={t('server.descriptionPlaceholder')}
          />
        </div>

        <div className="mb-4">
          <label className="block text-sm font-medium mb-1.5 text-[var(--hub-ink-2)]" htmlFor="visibility">
            {t('server.visibility', 'Visibility')}
          </label>
          <select
            id="visibility"
            name="visibility"
            value={formData.visibility || 'private'}
            onChange={(e) =>
              setFormData((prev) => ({
                ...prev,
                visibility: e.target.value as 'private' | 'group' | 'public',
              }))
            }
            className="w-full py-2 px-3 form-input"
          >
            <option value="private">
              {t('server.visibilityPrivate', 'Private — only the owner and admins')}
            </option>
            {formData.visibility === 'group' && (
              // 'group' is a reserved enum value; the filter doesn't yet honour it.
              // Surface it as a disabled option so a server pre-set to 'group' (e.g.
              // via direct DB update or a future user→group migration) renders
              // intelligibly rather than silently falling back to 'private' in the UI.
              <option value="group" disabled>
                {t('server.visibilityGroup', 'Group (reserved — not yet implemented)')}
              </option>
            )}
            <option value="public">
              {t('server.visibilityPublic', 'Public — every authenticated user')}
            </option>
          </select>
          <p className="text-xs text-gray-500 mt-1">
            {t(
              'server.visibilityDescription',
              "Controls which non-admin users see this server in tools/list. Admins always see all servers regardless of this setting.",
            )}
          </p>
        </div>

        <div className="mb-4">
          <label className="block text-sm font-medium mb-1.5 text-[var(--hub-ink-2)]">{t('server.type')}</label>
          <div className="flex space-x-4">
            <div>
              <input
                type="radio"
                id="command"
                name="serverType"
                value="command"
                checked={serverType === 'stdio'}
                onChange={() => updateServerType('stdio')}
                className="mr-1"
              />
              <label htmlFor="command" className="text-[var(--hub-ink)]">{t('server.typeStdio')}</label>
            </div>
            <div>
              <input
                type="radio"
                id="url"
                name="serverType"
                value="url"
                checked={serverType === 'sse'}
                onChange={() => updateServerType('sse')}
                className="mr-1"
              />
              <label htmlFor="url" className="text-[var(--hub-ink)]">{t('server.typeSse')}</label>
            </div>
            <div>
              <input
                type="radio"
                id="streamable-http"
                name="serverType"
                value="streamable-http"
                checked={serverType === 'streamable-http'}
                onChange={() => updateServerType('streamable-http')}
                className="mr-1"
              />
              <label htmlFor="streamable-http" className="text-[var(--hub-ink)]">{t('server.typeStreamableHttp')}</label>
            </div>
            <div>
              <input
                type="radio"
                id="openapi"
                name="serverType"
                value="openapi"
                checked={serverType === 'openapi'}
                onChange={() => updateServerType('openapi')}
                className="mr-1"
              />
              <label htmlFor="openapi" className="text-[var(--hub-ink)]">{t('server.typeOpenapi')}</label>
            </div>
          </div>
        </div>

        {serverType === 'openapi' ? (
          <>
            {/* Input Mode Selection */}
            <div className="mb-4">
              <label className="block text-sm font-medium mb-1.5 text-[var(--hub-ink-2)]">
                {t('server.openapi.inputMode')}
              </label>
              <div className="flex space-x-4">
                <div>
                  <input
                    type="radio"
                    id="input-mode-url"
                    name="inputMode"
                    value="url"
                    checked={formData.openapi?.inputMode === 'url'}
                    onChange={() =>
                      setFormData((prev) => ({
                        ...prev,
                        openapi: { ...prev.openapi!, inputMode: 'url' },
                      }))
                    }
                    className="mr-1"
                  />
                  <label htmlFor="input-mode-url">{t('server.openapi.inputModeUrl')}</label>
                </div>
                <div>
                  <input
                    type="radio"
                    id="input-mode-schema"
                    name="inputMode"
                    value="schema"
                    checked={formData.openapi?.inputMode === 'schema'}
                    onChange={() =>
                      setFormData((prev) => ({
                        ...prev,
                        openapi: { ...prev.openapi!, inputMode: 'schema' },
                      }))
                    }
                    className="mr-1"
                  />
                  <label htmlFor="input-mode-schema">{t('server.openapi.inputModeSchema')}</label>
                </div>
              </div>
            </div>

            {/* URL Input */}
            {formData.openapi?.inputMode === 'url' && (
              <div className="mb-4">
                <label className="block text-sm font-medium mb-1.5 text-[var(--hub-ink-2)]" htmlFor="openapi-url">
                  {t('server.openapi.specUrl')}
                </label>
                <input
                  type="url"
                  name="openapi-url"
                  id="openapi-url"
                  value={formData.openapi?.url || ''}
                  onChange={(e) =>
                    setFormData((prev) => ({
                      ...prev,
                      openapi: { ...prev.openapi!, url: e.target.value },
                    }))
                  }
                  className="w-full py-2 px-3 form-input"
                  placeholder="e.g.: https://api.example.com/openapi.json"
                  required={serverType === 'openapi' && formData.openapi?.inputMode === 'url'}
                />
              </div>
            )}

            {/* Schema Input */}
            {formData.openapi?.inputMode === 'schema' && (
              <div className="mb-4">
                <label
                  className="block text-sm font-medium mb-1.5 text-[var(--hub-ink-2)]"
                  htmlFor="openapi-schema"
                >
                  {t('server.openapi.schema')}
                </label>
                <textarea
                  name="openapi-schema"
                  id="openapi-schema"
                  rows={10}
                  value={formData.openapi?.schema || ''}
                  onChange={(e) =>
                    setFormData((prev) => ({
                      ...prev,
                      openapi: { ...prev.openapi!, schema: e.target.value },
                    }))
                  }
                  className="w-full py-2 px-3 form-input font-mono text-sm"
                  placeholder={`{
  "openapi": "3.1.0",
  "info": {
    "title": "API",
    "version": "1.0.0"
  },
  "servers": [
    {
      "url": "https://api.example.com"
    }
  ],
  "paths": {
    ...
  }
}`}
                  required={serverType === 'openapi' && formData.openapi?.inputMode === 'schema'}
                />
                <p className="text-xs text-[var(--hub-ink-3)] mt-1">{t('server.openapi.schemaHelp')}</p>
              </div>
            )}

            {/* Security Configuration */}
            <div className="mb-4">
              <label className="block text-sm font-medium mb-1.5 text-[var(--hub-ink-2)]">
                {t('server.openapi.security')}
              </label>
              <select
                value={formData.openapi?.securityType || 'none'}
                onChange={(e) =>
                  setFormData((prev) => ({
                    ...prev,
                    openapi: {
                      ...prev.openapi,
                      securityType: e.target.value as any,
                      url: prev.openapi?.url || '',
                    },
                  }))
                }
                className="w-full py-2 px-3 form-input"
              >
                <option value="none">{t('server.openapi.securityNone')}</option>
                <option value="apiKey">{t('server.openapi.securityApiKey')}</option>
                <option value="http">{t('server.openapi.securityHttp')}</option>
                <option value="oauth2">{t('server.openapi.securityOAuth2')}</option>
                <option value="openIdConnect">{t('server.openapi.securityOpenIdConnect')}</option>
              </select>
            </div>

            {/* API Key Configuration */}
            {formData.openapi?.securityType === 'apiKey' && (
              <div className="mb-4 p-4 border border-gray-200 dark:border-gray-700 rounded bg-gray-50 dark:bg-gray-800">
                <h4 className="text-sm font-medium mb-3 text-[var(--hub-ink-2)]">
                  {t('server.openapi.apiKeyConfig')}
                </h4>
                <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                  <div>
                    <label className="block text-xs text-[var(--hub-ink-2)] mb-1">
                      {t('server.openapi.apiKeyName')}
                    </label>
                    <input
                      type="text"
                      value={formData.openapi?.apiKeyName || ''}
                      onChange={(e) =>
                        setFormData((prev) => ({
                          ...prev,
                          openapi: {
                            ...prev.openapi,
                            apiKeyName: e.target.value,
                            url: prev.openapi?.url || '',
                          },
                        }))
                      }
                      className="w-full border rounded px-2 py-1 text-sm form-input focus:outline-none"
                      placeholder="Authorization"
                    />
                  </div>
                  <div>
                    <label className="block text-xs text-[var(--hub-ink-2)] mb-1">
                      {t('server.openapi.apiKeyIn')}
                    </label>
                    <select
                      value={formData.openapi?.apiKeyIn || 'header'}
                      onChange={(e) =>
                        setFormData((prev) => ({
                          ...prev,
                          openapi: {
                            ...prev.openapi,
                            apiKeyIn: e.target.value as any,
                            url: prev.openapi?.url || '',
                          },
                        }))
                      }
                      className="w-full border rounded px-2 py-1 text-sm focus:outline-none form-input"
                    >
                      <option value="header">{t('server.openapi.apiKeyInHeader')}</option>
                      <option value="query">{t('server.openapi.apiKeyInQuery')}</option>
                      <option value="cookie">{t('server.openapi.apiKeyInCookie')}</option>
                    </select>
                  </div>
                  <div>
                    <label className="block text-xs text-gray-600 mb-1">
                      {t('server.openapi.apiKeyValue')}
                    </label>
                    <input
                      type="password"
                      value={formData.openapi?.apiKeyValue || ''}
                      onChange={(e) =>
                        setFormData((prev) => ({
                          ...prev,
                          openapi: {
                            ...prev.openapi,
                            apiKeyValue: e.target.value,
                            url: prev.openapi?.url || '',
                          },
                        }))
                      }
                      className="w-full border rounded px-2 py-1 text-sm focus:outline-none form-input"
                      placeholder="your-api-key"
                    />
                  </div>
                </div>
              </div>
            )}

            {/* HTTP Authentication Configuration */}
            {formData.openapi?.securityType === 'http' && (
              <div className="mb-4 p-4 border border-gray-200 dark:border-gray-700 rounded bg-gray-50 dark:bg-gray-800">
                <h4 className="text-sm font-medium mb-3 text-gray-700 dark:text-gray-300">
                  {t('server.openapi.httpAuthConfig')}
                </h4>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                  <div>
                    <label className="block text-xs text-gray-600 mb-1">
                      {t('server.openapi.httpScheme')}
                    </label>
                    <select
                      value={formData.openapi?.httpScheme || 'bearer'}
                      onChange={(e) =>
                        setFormData((prev) => ({
                          ...prev,
                          openapi: {
                            ...prev.openapi,
                            httpScheme: e.target.value as any,
                            url: prev.openapi?.url || '',
                          },
                        }))
                      }
                      className="w-full border rounded px-2 py-1 text-sm focus:outline-none form-input"
                    >
                      <option value="basic">{t('server.openapi.httpSchemeBasic')}</option>
                      <option value="bearer">{t('server.openapi.httpSchemeBearer')}</option>
                      <option value="digest">{t('server.openapi.httpSchemeDigest')}</option>
                    </select>
                  </div>
                  <div>
                    <label className="block text-xs text-gray-600 mb-1">
                      {t('server.openapi.httpCredentials')}
                    </label>
                    <input
                      type="password"
                      value={formData.openapi?.httpCredentials || ''}
                      onChange={(e) =>
                        setFormData((prev) => ({
                          ...prev,
                          openapi: {
                            ...prev.openapi,
                            httpCredentials: e.target.value,
                            url: prev.openapi?.url || '',
                          },
                        }))
                      }
                      className="w-full border rounded px-2 py-1 text-sm focus:outline-none form-input"
                      placeholder={
                        formData.openapi?.httpScheme === 'basic'
                          ? 'base64-encoded-credentials'
                          : 'bearer-token'
                      }
                    />
                  </div>
                </div>
              </div>
            )}

            {/* OAuth2 Configuration */}
            {formData.openapi?.securityType === 'oauth2' && (
              <div className="mb-4 p-4 border border-gray-200 dark:border-gray-700 rounded bg-gray-50 dark:bg-gray-800">
                <h4 className="text-sm font-medium mb-3 text-gray-700 dark:text-gray-300">
                  {t('server.openapi.oauth2Config')}
                </h4>
                <div className="grid grid-cols-1 gap-3">
                  <div>
                    <label className="block text-xs text-gray-600 mb-1">
                      {t('server.oauth.tokenEndpoint')}
                    </label>
                    <input
                      type="url"
                      value={formData.openapi?.oauth2TokenUrl || ''}
                      onChange={(e) =>
                        setFormData((prev) => ({
                          ...prev,
                          openapi: {
                            ...prev.openapi,
                            oauth2TokenUrl: e.target.value,
                            url: prev.openapi?.url || '',
                          },
                        }))
                      }
                      className="w-full border rounded px-2 py-1 text-sm focus:outline-none form-input"
                      placeholder="https://example.com/oauth/token"
                    />
                  </div>
                  <div>
                    <label className="block text-xs text-gray-600 mb-1">
                      {t('server.oauth.clientId')}
                    </label>
                    <input
                      type="text"
                      value={formData.openapi?.oauth2ClientId || ''}
                      onChange={(e) =>
                        setFormData((prev) => ({
                          ...prev,
                          openapi: {
                            ...prev.openapi,
                            oauth2ClientId: e.target.value,
                            url: prev.openapi?.url || '',
                          },
                        }))
                      }
                      className="w-full border rounded px-2 py-1 text-sm focus:outline-none form-input"
                      placeholder="client-id"
                    />
                  </div>
                  <div>
                    <label className="block text-xs text-gray-600 mb-1">
                      {t('server.oauth.clientSecret')}
                    </label>
                    <input
                      type="password"
                      value={formData.openapi?.oauth2ClientSecret || ''}
                      onChange={(e) =>
                        setFormData((prev) => ({
                          ...prev,
                          openapi: {
                            ...prev.openapi,
                            oauth2ClientSecret: e.target.value,
                            url: prev.openapi?.url || '',
                          },
                        }))
                      }
                      className="w-full border rounded px-2 py-1 text-sm focus:outline-none form-input"
                      placeholder="client-secret"
                    />
                  </div>
                  <div>
                    <label className="block text-xs text-gray-600 mb-1">
                      {t('server.openapi.oauth2Token')}
                    </label>
                    <input
                      type="password"
                      value={formData.openapi?.oauth2Token || ''}
                      onChange={(e) =>
                        setFormData((prev) => ({
                          ...prev,
                          openapi: {
                            ...prev.openapi,
                            oauth2Token: e.target.value,
                            url: prev.openapi?.url || '',
                          },
                        }))
                      }
                      className="w-full border rounded px-2 py-1 text-sm focus:outline-none form-input"
                      placeholder="access-token"
                    />
                  </div>
                </div>
              </div>
            )}

            {/* OpenID Connect Configuration */}
            {formData.openapi?.securityType === 'openIdConnect' && (
              <div className="mb-4 p-4 border border-gray-200 dark:border-gray-700 rounded bg-gray-50 dark:bg-gray-800">
                <h4 className="text-sm font-medium mb-3 text-gray-700 dark:text-gray-300">
                  {t('server.openapi.openIdConnectConfig')}
                </h4>
                <div className="grid grid-cols-1 gap-3">
                  <div>
                    <label className="block text-xs text-gray-600 mb-1">
                      {t('server.openapi.openIdConnectUrl')}
                    </label>
                    <input
                      type="url"
                      value={formData.openapi?.openIdConnectUrl || ''}
                      onChange={(e) =>
                        setFormData((prev) => ({
                          ...prev,
                          openapi: {
                            ...prev.openapi,
                            openIdConnectUrl: e.target.value,
                            url: prev.openapi?.url || '',
                          },
                        }))
                      }
                      className="w-full border rounded px-2 py-1 text-sm focus:outline-none form-input"
                      placeholder="https://example.com/.well-known/openid_configuration"
                    />
                  </div>
                  <div>
                    <label className="block text-xs text-gray-600 mb-1">
                      {t('server.openapi.openIdConnectToken')}
                    </label>
                    <input
                      type="password"
                      value={formData.openapi?.openIdConnectToken || ''}
                      onChange={(e) =>
                        setFormData((prev) => ({
                          ...prev,
                          openapi: {
                            ...prev.openapi,
                            openIdConnectToken: e.target.value,
                            url: prev.openapi?.url || '',
                          },
                        }))
                      }
                      className="w-full border rounded px-2 py-1 text-sm focus:outline-none form-input"
                      placeholder="id-token"
                    />
                  </div>
                </div>
              </div>
            )}

            {/* Passthrough Headers Configuration */}
            <div className="mb-4">
              <label className="block text-sm font-medium mb-1.5 text-gray-700 dark:text-gray-300">
                {t('server.openapi.passthroughHeaders')}
              </label>
              <input
                type="text"
                value={formData.openapi?.passthroughHeaders || ''}
                onChange={(e) =>
                  setFormData((prev) => ({
                    ...prev,
                    openapi: {
                      ...prev.openapi,
                      passthroughHeaders: e.target.value,
                      url: prev.openapi?.url || '',
                    },
                  }))
                }
                className="w-full py-2 px-3 form-input"
                placeholder="Authorization, X-API-Key, X-Custom-Header"
              />
              <p className="text-xs text-gray-500 mt-1">
                {t('server.openapi.passthroughHeadersHelp')}
              </p>
            </div>

            <div className="mb-4">
              <div className="flex justify-between items-center mb-2">
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300">
                  {t('server.headers')}
                </label>
                <button
                  type="button"
                  onClick={addHeaderVar}
                  className="bg-gray-200 hover:bg-gray-300 text-gray-700 font-medium py-1 px-2 rounded text-sm flex items-center justify-center min-w-[30px] min-h-[30px] btn-primary"
                >
                  +
                </button>
              </div>
              {headerVars.map((headerVar, index) => (
                <div key={index} className="flex items-center mb-2">
                  <div className="flex items-center space-x-2 flex-grow">
                    <input
                      type="text"
                      value={headerVar.key}
                      onChange={(e) => handleHeaderVarChange(index, 'key', e.target.value)}
                      className="w-1/2 py-2 px-3 form-input"
                      placeholder="Authorization"
                    />
                    <span className="flex items-center">:</span>
                    <input
                      type="text"
                      value={headerVar.value}
                      onChange={(e) => handleHeaderVarChange(index, 'value', e.target.value)}
                      className="w-1/2 py-2 px-3 form-input"
                      placeholder="Bearer token..."
                    />
                  </div>
                  <button
                    type="button"
                    onClick={() => removeHeaderVar(index)}
                    className="bg-gray-200 hover:bg-gray-300 text-gray-700 font-medium py-1 px-2 rounded text-sm flex items-center justify-center min-w-[30px] min-h-[30px] ml-2 btn-danger"
                  >
                    -
                  </button>
                </div>
              ))}
            </div>
          </>
        ) : serverType === 'sse' || serverType === 'streamable-http' ? (
          <>
            <div className="mb-4">
              <label className="block text-sm font-medium mb-1.5 text-gray-700 dark:text-gray-300" htmlFor="url">
                {t('server.url')}
              </label>
              <input
                type="url"
                name="url"
                id="url"
                value={formData.url}
                onChange={handleInputChange}
                className="w-full py-2 px-3 form-input"
                placeholder={
                  serverType === 'streamable-http'
                    ? 'e.g.: http://localhost:3000/mcp'
                    : 'e.g.: http://localhost:3000/sse'
                }
                required={serverType === 'sse' || serverType === 'streamable-http'}
              />
            </div>

            <div className="mb-4">
              <div className="flex justify-between items-center mb-2">
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300">
                  {t('server.headers')}
                </label>
                <button
                  type="button"
                  onClick={addHeaderVar}
                  className="bg-gray-200 hover:bg-gray-300 text-gray-700 font-medium py-1 px-2 rounded text-sm flex items-center justify-center min-w-[30px] min-h-[30px] btn-primary"
                >
                  +
                </button>
              </div>
              {headerVars.map((headerVar, index) => (
                <div key={index} className="flex items-center mb-2">
                  <div className="flex items-center space-x-2 flex-grow">
                    <input
                      type="text"
                      value={headerVar.key}
                      onChange={(e) => handleHeaderVarChange(index, 'key', e.target.value)}
                      className="w-1/2 py-2 px-3 form-input"
                      placeholder="Authorization"
                    />
                    <span className="flex items-center">:</span>
                    <input
                      type="text"
                      value={headerVar.value}
                      onChange={(e) => handleHeaderVarChange(index, 'value', e.target.value)}
                      className="w-1/2 py-2 px-3 form-input"
                      placeholder="Bearer token..."
                    />
                  </div>
                  <button
                    type="button"
                    onClick={() => removeHeaderVar(index)}
                    className="bg-gray-200 hover:bg-gray-300 text-gray-700 font-medium py-1 px-2 rounded text-sm flex items-center justify-center min-w-[30px] min-h-[30px] ml-2 btn-danger"
                  >
                    -
                  </button>
                </div>
              ))}
            </div>

            <div className="mb-4">
              <label className="block text-sm font-medium mb-1.5 text-gray-700 dark:text-gray-300">
                {t('server.openapi.passthroughHeaders')}
              </label>
              <input
                type="text"
                value={formData.passthroughHeaders || ''}
                onChange={(e) =>
                  setFormData((prev) => ({
                    ...prev,
                    passthroughHeaders: e.target.value,
                  }))
                }
                className="w-full py-2 px-3 form-input"
                placeholder="Authorization, X-Custom-User-Id"
              />
              <p className="text-xs text-gray-500 mt-1">
                {t('server.openapi.passthroughHeadersHelp')}
              </p>
            </div>

            <div className="mb-4">
              <div className="flex justify-between items-center mb-2">
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300">
                  {t('server.envVars')}
                </label>
                <button
                  type="button"
                  onClick={addEnvVar}
                  className="bg-gray-200 hover:bg-gray-300 text-gray-700 font-medium py-1 px-2 rounded text-sm flex items-center justify-center min-w-[30px] min-h-[30px] btn-primary"
                >
                  +
                </button>
              </div>
              {envVars.map((envVar, index) => (
                <div key={index} className="flex items-center mb-2">
                  <div className="flex items-center space-x-2 flex-grow">
                    <input
                      type="text"
                      value={envVar.key}
                      onChange={(e) => handleEnvVarChange(index, 'key', e.target.value)}
                      className="w-1/2 py-2 px-3 form-input"
                      placeholder={t('server.key')}
                    />
                    <span className="flex items-center">:</span>
                    <input
                      type="text"
                      value={envVar.value}
                      onChange={(e) => handleEnvVarChange(index, 'value', e.target.value)}
                      className="w-1/2 py-2 px-3 form-input"
                      placeholder={t('server.value')}
                    />
                  </div>
                  <button
                    type="button"
                    onClick={() => removeEnvVar(index)}
                    className="bg-gray-200 hover:bg-gray-300 text-gray-700 font-medium py-1 px-2 rounded text-sm flex items-center justify-center min-w-[30px] min-h-[30px] ml-2 btn-danger"
                  >
                    -
                  </button>
                </div>
              ))}
            </div>

            <div className="mb-4">
              <div
                className="flex items-center justify-between cursor-pointer bg-gray-50 dark:bg-gray-800 hover:bg-gray-100 p-3 rounded border border-gray-200 dark:border-gray-700"
                onClick={() => setIsOAuthSectionExpanded(!isOAuthSectionExpanded)}
              >
                <label className="text-sm font-medium text-gray-700 dark:text-gray-300">
                  {t('server.oauth.sectionTitle')}
                </label>
                <span className="text-gray-500 text-sm">{isOAuthSectionExpanded ? '▼' : '▶'}</span>
              </div>

              {isOAuthSectionExpanded && (
                <div className="border border-gray-200 dark:border-gray-700 rounded-b p-4 bg-gray-50 dark:bg-gray-800 border-t-0">
                  <p className="text-xs text-gray-500 mb-3">
                    {t('server.oauth.sectionDescription')}
                  </p>
                  <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
                    <div>
                      <label className="block text-xs text-gray-600 mb-1">
                        {t('server.oauth.clientId')}
                      </label>
                      <input
                        type="text"
                        value={formData.oauth?.clientId || ''}
                        onChange={(e) => handleOAuthChange('clientId', e.target.value)}
                        className="w-full py-2 px-3 form-input"
                        placeholder="client id"
                        autoComplete="off"
                      />
                    </div>
                    <div>
                      <label className="block text-xs text-gray-600 mb-1">
                        {t('server.oauth.clientSecret')}
                      </label>
                      <input
                        type="password"
                        value={formData.oauth?.clientSecret || ''}
                        onChange={(e) => handleOAuthChange('clientSecret', e.target.value)}
                        className="w-full py-2 px-3 form-input"
                        placeholder="client secret"
                        autoComplete="off"
                      />
                    </div>
                    {/* 
                    <div>
                      <label className="block text-xs text-gray-600 mb-1">
                        {t('server.oauth.authorizationEndpoint')}
                      </label>
                      <input
                        type="url"
                        value={formData.oauth?.authorizationEndpoint || ''}
                        onChange={(e) => handleOAuthChange('authorizationEndpoint', e.target.value)}
                        className="w-full py-2 px-3 form-input"
                        placeholder="https://auth.example.com/authorize"
                      />
                    </div>
                    <div>
                      <label className="block text-xs text-gray-600 mb-1">
                        {t('server.oauth.tokenEndpoint')}
                      </label>
                      <input
                        type="url"
                        value={formData.oauth?.tokenEndpoint || ''}
                        onChange={(e) => handleOAuthChange('tokenEndpoint', e.target.value)}
                        className="w-full py-2 px-3 form-input"
                        placeholder="https://auth.example.com/token"
                      />
                    </div>
                    <div>
                      <label className="block text-xs text-gray-600 mb-1">
                        {t('server.oauth.scopes')}
                      </label>
                      <input
                        type="text"
                        value={formData.oauth?.scopes || ''}
                        onChange={(e) => handleOAuthChange('scopes', e.target.value)}
                        className="w-full py-2 px-3 form-input"
                        placeholder={t('server.oauth.scopesPlaceholder')}
                        autoComplete="off"
                      />
                    </div>
                    <div>
                      <label className="block text-xs text-gray-600 mb-1">
                        {t('server.oauth.resource')}
                      </label>
                      <input
                        type="text"
                        value={formData.oauth?.resource || ''}
                        onChange={(e) => handleOAuthChange('resource', e.target.value)}
                        className="w-full py-2 px-3 form-input"
                        placeholder="https://mcp.example.com/mcp"
                        autoComplete="off"
                      />
                    </div>
                    <div>
                      <label className="block text-xs text-gray-600 mb-1">
                        {t('server.oauth.accessToken')}
                      </label>
                      <input
                        type="password"
                        value={formData.oauth?.accessToken || ''}
                        onChange={(e) => handleOAuthChange('accessToken', e.target.value)}
                        className="w-full py-2 px-3 form-input"
                        placeholder="access-token"
                        autoComplete="off"
                      />
                    </div>
                    <div>
                      <label className="block text-xs text-gray-600 mb-1">
                        {t('server.oauth.refreshToken')}
                      </label>
                      <input
                        type="password"
                        value={formData.oauth?.refreshToken || ''}
                        onChange={(e) => handleOAuthChange('refreshToken', e.target.value)}
                        className="w-full py-2 px-3 form-input"
                        placeholder="refresh-token"
                        autoComplete="off"
                      />
                    </div>
                    */}
                  </div>
                </div>
              )}
            </div>
          </>
        ) : (
          <>
            <div className="mb-4">
              <label className="block text-sm font-medium mb-1.5 text-gray-700 dark:text-gray-300" htmlFor="command">
                {t('server.command')}
              </label>
              <input
                type="text"
                name="command"
                id="command"
                value={formData.command}
                onChange={handleInputChange}
                className="w-full py-2 px-3 form-input"
                placeholder="e.g.: npx"
                required={serverType === 'stdio'}
              />
            </div>
            <div className="mb-4">
              <label className="block text-sm font-medium mb-1.5 text-gray-700 dark:text-gray-300" htmlFor="arguments">
                {t('server.arguments')}
              </label>
              <input
                type="text"
                name="arguments"
                id="arguments"
                value={formData.arguments}
                onChange={(e) => handleArgsChange(e.target.value)}
                className="w-full py-2 px-3 form-input"
                placeholder="e.g.: -y time-mcp"
                required={serverType === 'stdio'}
              />
            </div>

            <div className="mb-4">
              <div className="flex justify-between items-center mb-2">
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300">
                  {t('server.envVars')}
                </label>
                <button
                  type="button"
                  onClick={addEnvVar}
                  className="bg-gray-200 hover:bg-gray-300 text-gray-700 font-medium py-1 px-2 rounded text-sm flex items-center justify-center min-w-[30px] min-h-[30px] btn-primary"
                >
                  +
                </button>
              </div>
              {envVars.map((envVar, index) => (
                <div key={index} className="flex items-center mb-2">
                  <div className="flex items-center space-x-2 flex-grow">
                    <input
                      type="text"
                      value={envVar.key}
                      onChange={(e) => handleEnvVarChange(index, 'key', e.target.value)}
                      className="w-1/2 py-2 px-3 form-input"
                      placeholder={t('server.key')}
                    />
                    <span className="flex items-center">:</span>
                    <input
                      type="text"
                      value={envVar.value}
                      onChange={(e) => handleEnvVarChange(index, 'value', e.target.value)}
                      className="w-1/2 py-2 px-3 form-input"
                      placeholder={t('server.value')}
                    />
                  </div>
                  <button
                    type="button"
                    onClick={() => removeEnvVar(index)}
                    className="bg-gray-200 hover:bg-gray-300 text-gray-700 font-medium py-1 px-2 rounded text-sm flex items-center justify-center min-w-[30px] min-h-[30px] ml-2 btn-danger"
                  >
                    -
                  </button>
                </div>
              ))}
            </div>
          </>
        )}

        {/* Request Options Configuration */}
        {serverType !== 'openapi' && (
          <div className="mb-4">
            <div
              className="flex items-center justify-between cursor-pointer bg-gray-50 dark:bg-gray-800 hover:bg-gray-100 p-3 rounded border border-gray-200 dark:border-gray-700"
              onClick={() => setIsRequestOptionsExpanded(!isRequestOptionsExpanded)}
            >
              <label className="text-sm font-medium text-gray-700 dark:text-gray-300">
                {t('server.requestOptions')}
              </label>
              <span className="text-gray-500 text-sm">{isRequestOptionsExpanded ? '▼' : '▶'}</span>
            </div>

            {isRequestOptionsExpanded && (
              <div className="border border-gray-200 dark:border-gray-700 rounded-b p-4 bg-gray-50 dark:bg-gray-800 border-t-0">
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div>
                    <label
                      className="block text-gray-600 text-sm font-medium mb-1"
                      htmlFor="timeout"
                    >
                      {t('server.timeout')}
                    </label>
                    <input
                      type="number"
                      id="timeout"
                      value={formData.options?.timeout || 60000}
                      onChange={(e) =>
                        handleOptionsChange('timeout', parseInt(e.target.value) || 60000)
                      }
                      className="w-full py-2 px-3 form-input"
                      placeholder="30000"
                      min="1000"
                      max="300000"
                    />
                    <p className="text-xs text-gray-500 mt-1">{t('server.timeoutDescription')}</p>
                  </div>

                  <div>
                    <label
                      className="block text-gray-600 text-sm font-medium mb-1"
                      htmlFor="maxTotalTimeout"
                    >
                      {t('server.maxTotalTimeout')}
                    </label>
                    <input
                      type="number"
                      id="maxTotalTimeout"
                      value={formData.options?.maxTotalTimeout || ''}
                      onChange={(e) =>
                        handleOptionsChange(
                          'maxTotalTimeout',
                          e.target.value ? parseInt(e.target.value) : undefined,
                        )
                      }
                      className="w-full py-2 px-3 form-input"
                      placeholder="Optional"
                      min="1000"
                    />
                    <p className="text-xs text-gray-500 mt-1">
                      {t('server.maxTotalTimeoutDescription')}
                    </p>
                  </div>
                </div>

                <div className="mt-3">
                  <label className="flex items-center">
                    <input
                      type="checkbox"
                      checked={formData.options?.resetTimeoutOnProgress ?? true}
                      onChange={(e) =>
                        handleOptionsChange('resetTimeoutOnProgress', e.target.checked)
                      }
                      className="mr-2"
                    />
                    <span className="text-gray-600 text-sm">
                      {t('server.resetTimeoutOnProgress')}
                    </span>
                  </label>
                  <p className="text-xs text-gray-500 mt-1 ml-6">
                    {t('server.resetTimeoutOnProgressDescription')}
                  </p>
                </div>
              </div>
            )}
          </div>
        )}

        {/* KeepAlive Configuration - only for SSE/Streamable HTTP */}
        {(serverType === 'sse' || serverType === 'streamable-http') && (
          <div className="mb-4">
            <div
              className="flex items-center justify-between cursor-pointer bg-gray-50 dark:bg-gray-800 hover:bg-gray-100 p-3 rounded border border-gray-200 dark:border-gray-700"
              onClick={() => setIsKeepAliveSectionExpanded(!isKeepAliveSectionExpanded)}
            >
              <label className="text-sm font-medium text-gray-700 dark:text-gray-300">
                {t('server.keepAlive', 'Connection Health')}
              </label>
              <span className="text-gray-500 text-sm">
                {isKeepAliveSectionExpanded ? '▼' : '▶'}
              </span>
            </div>

            {isKeepAliveSectionExpanded && (
              <div className="border border-gray-200 dark:border-gray-700 rounded-b p-4 bg-gray-50 dark:bg-gray-800 border-t-0">
                <div className="flex items-center mb-3">
                  <input
                    type="checkbox"
                    id="enableKeepAlive"
                    checked={formData.keepAlive?.enabled || false}
                    onChange={(e) =>
                      setFormData((prev) => ({
                        ...prev,
                        keepAlive: {
                          ...prev.keepAlive,
                          enabled: e.target.checked,
                        },
                      }))
                    }
                    className="mr-2"
                  />
                  <label htmlFor="enableKeepAlive" className="text-gray-600 text-sm">
                    {t('server.enableKeepAlive', 'Enable Health Checks and Auto Reconnect')}
                  </label>
                </div>
                <p className="text-xs text-gray-500 mb-3">
                  {t(
                    'server.keepAliveDescription',
                    'Run periodic health checks and automatically reconnect this remote server when it becomes disconnected.',
                  )}
                </p>
                <div>
                  <label
                    className="block text-gray-600 text-sm font-medium mb-1"
                    htmlFor="keepAliveInterval"
                  >
                    {t('server.keepAliveInterval', 'Check interval (ms)')}
                  </label>
                  <input
                    type="number"
                    id="keepAliveInterval"
                    value={formData.keepAlive?.interval || 60000}
                    onChange={(e) =>
                      setFormData((prev) => ({
                        ...prev,
                        keepAlive: {
                          ...prev.keepAlive,
                          interval: parseInt(e.target.value) || 60000,
                        },
                      }))
                    }
                    className="w-full py-2 px-3 form-input"
                    placeholder="60000"
                    min="5000"
                    max="300000"
                  />
                  <p className="text-xs text-gray-500 mt-1">
                    {t(
                      'server.keepAliveIntervalDescription',
                      'Time between health checks and automatic reconnect attempts in milliseconds (default: 60000ms = 1 minute)',
                    )}
                  </p>
                </div>
              </div>
            )}
          </div>
        )}

        <div className="flex justify-end mt-6">
          <button
            type="button"
            onClick={onCancel}
            className="hub-btn mr-2"
          >
            {t('server.cancel')}
          </button>
          <button
            type="submit"
            className="hub-btn primary"
          >
            {isEdit ? t('server.save') : t('server.add')}
          </button>
        </div>
      </form>
    </div>
  );
};

export default ServerForm;
