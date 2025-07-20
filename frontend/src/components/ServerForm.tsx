import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Server, EnvVar, ServerFormData } from '@/types'

interface ServerFormProps {
  onSubmit: (payload: any) => void
  onCancel: () => void
  initialData?: Server | null
  modalTitle: string
  formError?: string | null
}

const ServerForm = ({ onSubmit, onCancel, initialData = null, modalTitle, formError = null }: ServerFormProps) => {
  const { t } = useTranslation()

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

  const [serverType, setServerType] = useState<'stdio' | 'sse' | 'streamable-http' | 'openapi'>(getInitialServerType());

  const [formData, setFormData] = useState<ServerFormData>({
    name: (initialData && initialData.name) || '',
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
    env: [],
    headers: [],
    options: {
      timeout: (initialData && initialData.config && initialData.config.options && initialData.config.options.timeout) || 60000,
      resetTimeoutOnProgress: (initialData && initialData.config && initialData.config.options && initialData.config.options.resetTimeoutOnProgress) || false,
      maxTotalTimeout: (initialData && initialData.config && initialData.config.options && initialData.config.options.maxTotalTimeout) || undefined,
    },
    // OpenAPI configuration initialization
    openapi: initialData && initialData.config && initialData.config.openapi ? {
      url: initialData.config.openapi.url || '',
      schema: initialData.config.openapi.schema ? JSON.stringify(initialData.config.openapi.schema, null, 2) : '',
      inputMode: initialData.config.openapi.url ? 'url' : (initialData.config.openapi.schema ? 'schema' : 'url'),
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
      oauth2Token: initialData.config.openapi.security?.oauth2?.token || '',
      // OpenID Connect initialization
      openIdConnectUrl: initialData.config.openapi.security?.openIdConnect?.url || '',
      openIdConnectToken: initialData.config.openapi.security?.openIdConnect?.token || ''
    } : {
      inputMode: 'url',
      url: '',
      schema: '',
      version: '3.1.0',
      securityType: 'none'
    }
  })

  const [envVars, setEnvVars] = useState<EnvVar[]>(
    initialData && initialData.config && initialData.config.env
      ? Object.entries(initialData.config.env).map(([key, value]) => ({ key, value }))
      : [],
  )

  const [headerVars, setHeaderVars] = useState<EnvVar[]>(
    initialData && initialData.config && initialData.config.headers
      ? Object.entries(initialData.config.headers).map(([key, value]) => ({ key, value }))
      : [],
  )

  const [isRequestOptionsExpanded, setIsRequestOptionsExpanded] = useState<boolean>(false)
  const [error, setError] = useState<string | null>(null)
  const isEdit = !!initialData

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const { name, value } = e.target
    setFormData({ ...formData, [name]: value })
  }

  // Transform space-separated arguments string into array
  const handleArgsChange = (value: string) => {
    const args = value.split(' ').filter((arg) => arg.trim() !== '')
    setFormData({ ...formData, arguments: value, args })
  }

  const updateServerType = (type: 'stdio' | 'sse' | 'streamable-http' | 'openapi') => {
    setServerType(type);
    setFormData(prev => ({ ...prev, type }));
  }

  const handleEnvVarChange = (index: number, field: 'key' | 'value', value: string) => {
    const newEnvVars = [...envVars]
    newEnvVars[index][field] = value
    setEnvVars(newEnvVars)
  }

  const addEnvVar = () => {
    setEnvVars([...envVars, { key: '', value: '' }])
  }

  const removeEnvVar = (index: number) => {
    const newEnvVars = [...envVars]
    newEnvVars.splice(index, 1)
    setEnvVars(newEnvVars)
  }

  const handleHeaderVarChange = (index: number, field: 'key' | 'value', value: string) => {
    const newHeaderVars = [...headerVars]
    newHeaderVars[index][field] = value
    setHeaderVars(newHeaderVars)
  }

  const addHeaderVar = () => {
    setHeaderVars([...headerVars, { key: '', value: '' }])
  }

  const removeHeaderVar = (index: number) => {
    const newHeaderVars = [...headerVars]
    newHeaderVars.splice(index, 1)
    setHeaderVars(newHeaderVars)
  }

  // Handle options changes
  const handleOptionsChange = (field: 'timeout' | 'resetTimeoutOnProgress' | 'maxTotalTimeout', value: number | boolean | undefined) => {
    setFormData(prev => ({
      ...prev,
      options: {
        ...prev.options,
        [field]: value
      }
    }))
  }

  // Submit handler for server configuration
  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError(null)

    try {
      const env: Record<string, string> = {}
      envVars.forEach(({ key, value }) => {
        if (key.trim()) {
          env[key.trim()] = value
        }
      })

      const headers: Record<string, string> = {}
      headerVars.forEach(({ key, value }) => {
        if (key.trim()) {
          headers[key.trim()] = value
        }
      })

      // Prepare options object, only include defined values
      const options: any = {}
      if (formData.options?.timeout && formData.options.timeout !== 60000) {
        options.timeout = formData.options.timeout
      }
      if (formData.options?.resetTimeoutOnProgress) {
        options.resetTimeoutOnProgress = formData.options.resetTimeoutOnProgress
      }
      if (formData.options?.maxTotalTimeout) {
        options.maxTotalTimeout = formData.options.maxTotalTimeout
      }

      const payload = {
        name: formData.name,
        config: {
          type: serverType, // Always include the type
          ...(serverType === 'openapi'
            ? {
              openapi: (() => {
                const openapi: any = {
                  version: formData.openapi?.version || '3.1.0'
                };

                // Add URL or schema based on input mode
                if (formData.openapi?.inputMode === 'url') {
                  openapi.url = formData.openapi?.url || '';
                } else if (formData.openapi?.inputMode === 'schema' && formData.openapi?.schema) {
                  try {
                    openapi.schema = JSON.parse(formData.openapi.schema);
                  } catch (e) {
                    throw new Error('Invalid JSON schema format');
                  }
                }

                // Add security configuration if provided
                if (formData.openapi?.securityType && formData.openapi.securityType !== 'none') {
                  openapi.security = {
                    type: formData.openapi.securityType,
                    ...(formData.openapi.securityType === 'apiKey' && {
                      apiKey: {
                        name: formData.openapi.apiKeyName || '',
                        in: formData.openapi.apiKeyIn || 'header',
                        value: formData.openapi.apiKeyValue || ''
                      }
                    }),
                    ...(formData.openapi.securityType === 'http' && {
                      http: {
                        scheme: formData.openapi.httpScheme || 'bearer',
                        credentials: formData.openapi.httpCredentials || ''
                      }
                    }),
                    ...(formData.openapi.securityType === 'oauth2' && {
                      oauth2: {
                        token: formData.openapi.oauth2Token || ''
                      }
                    }),
                    ...(formData.openapi.securityType === 'openIdConnect' && {
                      openIdConnect: {
                        url: formData.openapi.openIdConnectUrl || '',
                        token: formData.openapi.openIdConnectToken || ''
                      }
                    })
                  };
                }

                return openapi;
              })(),
              ...(Object.keys(headers).length > 0 ? { headers } : {})
            }
            : serverType === 'sse' || serverType === 'streamable-http'
              ? {
                url: formData.url,
                ...(Object.keys(headers).length > 0 ? { headers } : {})
              }
              : {
                command: formData.command,
                args: formData.args,
                env: Object.keys(env).length > 0 ? env : undefined,
              }
          ),
          ...(Object.keys(options).length > 0 ? { options } : {})
        }
      }

      onSubmit(payload)
    } catch (err) {
      setError(`Error: ${err instanceof Error ? err.message : String(err)}`)
    }
  }

  return (
    <div className="bg-white shadow rounded-lg p-6 w-full max-w-xl max-h-screen overflow-y-auto">
      <div className="flex justify-between items-center mb-4">
        <h2 className="text-xl font-semibold text-gray-900">{modalTitle}</h2>
        <button onClick={onCancel} className="text-gray-500 hover:text-gray-700">
          ✕
        </button>
      </div>

      {(error || formError) && (
        <div className="bg-red-50 text-red-700 p-3 rounded mb-4">
          {formError || error}
        </div>
      )}

      <form onSubmit={handleSubmit}>
        <div className="mb-4">
          <label className="block text-gray-700 text-sm font-bold mb-2" htmlFor="name">
            {t('server.name')}
          </label>
          <input
            type="text"
            name="name"
            id="name"
            value={formData.name}
            onChange={handleInputChange}
            className="shadow appearance-none border rounded w-full py-2 px-3 text-gray-700 leading-tight focus:outline-none focus:shadow-outline form-input"
            placeholder="e.g.: time-mcp"
            required
            disabled={isEdit}
          />
        </div>

        <div className="mb-4">
          <label className="block text-gray-700 text-sm font-bold mb-2">{t('server.type')}</label>
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
              <label htmlFor="command">STDIO</label>
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
              <label htmlFor="url">SSE</label>
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
              <label htmlFor="streamable-http">Streamable HTTP</label>
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
              <label htmlFor="openapi">OpenAPI</label>
            </div>
          </div>
        </div>

        {serverType === 'openapi' ? (
          <>
            {/* Input Mode Selection */}
            <div className="mb-4">
              <label className="block text-gray-700 text-sm font-bold mb-2">
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
                    onChange={() => setFormData(prev => ({
                      ...prev,
                      openapi: { ...prev.openapi!, inputMode: 'url' }
                    }))}
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
                    onChange={() => setFormData(prev => ({
                      ...prev,
                      openapi: { ...prev.openapi!, inputMode: 'schema' }
                    }))}
                    className="mr-1"
                  />
                  <label htmlFor="input-mode-schema">{t('server.openapi.inputModeSchema')}</label>
                </div>
              </div>
            </div>

            {/* URL Input */}
            {formData.openapi?.inputMode === 'url' && (
              <div className="mb-4">
                <label className="block text-gray-700 text-sm font-bold mb-2" htmlFor="openapi-url">
                  {t('server.openapi.specUrl')}
                </label>
                <input
                  type="url"
                  name="openapi-url"
                  id="openapi-url"
                  value={formData.openapi?.url || ''}
                  onChange={(e) => setFormData(prev => ({
                    ...prev,
                    openapi: { ...prev.openapi!, url: e.target.value }
                  }))}
                  className="shadow appearance-none border rounded w-full py-2 px-3 text-gray-700 leading-tight focus:outline-none focus:shadow-outline form-input"
                  placeholder="e.g.: https://api.example.com/openapi.json"
                  required={serverType === 'openapi' && formData.openapi?.inputMode === 'url'}
                />
              </div>
            )}

            {/* Schema Input */}
            {formData.openapi?.inputMode === 'schema' && (
              <div className="mb-4">
                <label className="block text-gray-700 text-sm font-bold mb-2" htmlFor="openapi-schema">
                  {t('server.openapi.schema')}
                </label>
                <textarea
                  name="openapi-schema"
                  id="openapi-schema"
                  rows={10}
                  value={formData.openapi?.schema || ''}
                  onChange={(e) => setFormData(prev => ({
                    ...prev,
                    openapi: { ...prev.openapi!, schema: e.target.value }
                  }))}
                  className="shadow appearance-none border rounded w-full py-2 px-3 text-gray-700 leading-tight focus:outline-none focus:shadow-outline font-mono text-sm"
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
                <p className="text-xs text-gray-500 mt-1">{t('server.openapi.schemaHelp')}</p>
              </div>
            )}

            {/* Security Configuration */}
            <div className="mb-4">
              <label className="block text-gray-700 text-sm font-bold mb-2">
                {t('server.openapi.security')}
              </label>
              <select
                value={formData.openapi?.securityType || 'none'}
                onChange={(e) => setFormData(prev => ({
                  ...prev,
                  openapi: {
                    ...prev.openapi,
                    securityType: e.target.value as any,
                    url: prev.openapi?.url || ''
                  }
                }))}
                className="shadow appearance-none border rounded w-full py-2 px-3 text-gray-700 leading-tight focus:outline-none focus:shadow-outline form-input"
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
              <div className="mb-4 p-4 border border-gray-200 rounded bg-gray-50">
                <h4 className="text-sm font-medium text-gray-700 mb-3">{t('server.openapi.apiKeyConfig')}</h4>
                <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                  <div>
                    <label className="block text-xs text-gray-600 mb-1">{t('server.openapi.apiKeyName')}</label>
                    <input
                      type="text"
                      value={formData.openapi?.apiKeyName || ''}
                      onChange={(e) => setFormData(prev => ({
                        ...prev,
                        openapi: { ...prev.openapi, apiKeyName: e.target.value, url: prev.openapi?.url || '' }
                      }))}
                      className="w-full border rounded px-2 py-1 text-sm form-input focus:outline-none"
                      placeholder="Authorization"
                    />
                  </div>
                  <div>
                    <label className="block text-xs text-gray-600 mb-1">{t('server.openapi.apiKeyIn')}</label>
                    <select
                      value={formData.openapi?.apiKeyIn || 'header'}
                      onChange={(e) => setFormData(prev => ({
                        ...prev,
                        openapi: { ...prev.openapi, apiKeyIn: e.target.value as any, url: prev.openapi?.url || '' }
                      }))}
                      className="w-full border rounded px-2 py-1 text-sm focus:outline-none form-input"
                    >
                      <option value="header">Header</option>
                      <option value="query">Query</option>
                      <option value="cookie">Cookie</option>
                    </select>
                  </div>
                  <div>
                    <label className="block text-xs text-gray-600 mb-1">{t('server.openapi.apiKeyValue')}</label>
                    <input
                      type="password"
                      value={formData.openapi?.apiKeyValue || ''}
                      onChange={(e) => setFormData(prev => ({
                        ...prev,
                        openapi: { ...prev.openapi, apiKeyValue: e.target.value, url: prev.openapi?.url || '' }
                      }))}
                      className="w-full border rounded px-2 py-1 text-sm focus:outline-none form-input"
                      placeholder="your-api-key"
                    />
                  </div>
                </div>
              </div>
            )}

            {/* HTTP Authentication Configuration */}
            {formData.openapi?.securityType === 'http' && (
              <div className="mb-4 p-4 border border-gray-200 rounded bg-gray-50">
                <h4 className="text-sm font-medium text-gray-700 mb-3">{t('server.openapi.httpAuthConfig')}</h4>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                  <div>
                    <label className="block text-xs text-gray-600 mb-1">{t('server.openapi.httpScheme')}</label>
                    <select
                      value={formData.openapi?.httpScheme || 'bearer'}
                      onChange={(e) => setFormData(prev => ({
                        ...prev,
                        openapi: { ...prev.openapi, httpScheme: e.target.value as any, url: prev.openapi?.url || '' }
                      }))}
                      className="w-full border rounded px-2 py-1 text-sm focus:outline-none form-input"
                    >
                      <option value="basic">Basic</option>
                      <option value="bearer">Bearer</option>
                      <option value="digest">Digest</option>
                    </select>
                  </div>
                  <div>
                    <label className="block text-xs text-gray-600 mb-1">{t('server.openapi.httpCredentials')}</label>
                    <input
                      type="password"
                      value={formData.openapi?.httpCredentials || ''}
                      onChange={(e) => setFormData(prev => ({
                        ...prev,
                        openapi: { ...prev.openapi, httpCredentials: e.target.value, url: prev.openapi?.url || '' }
                      }))}
                      className="w-full border rounded px-2 py-1 text-sm focus:outline-none form-input"
                      placeholder={formData.openapi?.httpScheme === 'basic' ? 'base64-encoded-credentials' : 'bearer-token'}
                    />
                  </div>
                </div>
              </div>
            )}

            {/* OAuth2 Configuration */}
            {formData.openapi?.securityType === 'oauth2' && (
              <div className="mb-4 p-4 border border-gray-200 rounded bg-gray-50">
                <h4 className="text-sm font-medium text-gray-700 mb-3">{t('server.openapi.oauth2Config')}</h4>
                <div className="grid grid-cols-1 gap-3">
                  <div>
                    <label className="block text-xs text-gray-600 mb-1">{t('server.openapi.oauth2Token')}</label>
                    <input
                      type="password"
                      value={formData.openapi?.oauth2Token || ''}
                      onChange={(e) => setFormData(prev => ({
                        ...prev,
                        openapi: { ...prev.openapi, oauth2Token: e.target.value, url: prev.openapi?.url || '' }
                      }))}
                      className="w-full border rounded px-2 py-1 text-sm focus:outline-none form-input"
                      placeholder="access-token"
                    />
                  </div>
                </div>
              </div>
            )}

            {/* OpenID Connect Configuration */}
            {formData.openapi?.securityType === 'openIdConnect' && (
              <div className="mb-4 p-4 border border-gray-200 rounded bg-gray-50">
                <h4 className="text-sm font-medium text-gray-700 mb-3">{t('server.openapi.openIdConnectConfig')}</h4>
                <div className="grid grid-cols-1 gap-3">
                  <div>
                    <label className="block text-xs text-gray-600 mb-1">{t('server.openapi.openIdConnectUrl')}</label>
                    <input
                      type="url"
                      value={formData.openapi?.openIdConnectUrl || ''}
                      onChange={(e) => setFormData(prev => ({
                        ...prev,
                        openapi: { ...prev.openapi, openIdConnectUrl: e.target.value, url: prev.openapi?.url || '' }
                      }))}
                      className="w-full border rounded px-2 py-1 text-sm focus:outline-none form-input"
                      placeholder="https://example.com/.well-known/openid_configuration"
                    />
                  </div>
                  <div>
                    <label className="block text-xs text-gray-600 mb-1">{t('server.openapi.openIdConnectToken')}</label>
                    <input
                      type="password"
                      value={formData.openapi?.openIdConnectToken || ''}
                      onChange={(e) => setFormData(prev => ({
                        ...prev,
                        openapi: { ...prev.openapi, openIdConnectToken: e.target.value, url: prev.openapi?.url || '' }
                      }))}
                      className="w-full border rounded px-2 py-1 text-sm focus:outline-none form-input"
                      placeholder="id-token"
                    />
                  </div>
                </div>
              </div>
            )}

            <div className="mb-4">
              <div className="flex justify-between items-center mb-2">
                <label className="block text-gray-700 text-sm font-bold">
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
                      className="shadow appearance-none border rounded py-2 px-3 text-gray-700 leading-tight focus:outline-none focus:shadow-outline w-1/2 form-input"
                      placeholder="Authorization"
                    />
                    <span className="flex items-center">:</span>
                    <input
                      type="text"
                      value={headerVar.value}
                      onChange={(e) => handleHeaderVarChange(index, 'value', e.target.value)}
                      className="shadow appearance-none border rounded py-2 px-3 text-gray-700 leading-tight focus:outline-none focus:shadow-outline w-1/2 form-input"
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
              <label className="block text-gray-700 text-sm font-bold mb-2" htmlFor="url">
                {t('server.url')}
              </label>
              <input
                type="url"
                name="url"
                id="url"
                value={formData.url}
                onChange={handleInputChange}
                className="shadow appearance-none border rounded w-full py-2 px-3 text-gray-700 leading-tight focus:outline-none focus:shadow-outline form-input"
                placeholder={serverType === 'streamable-http' ? "e.g.: http://localhost:3000/mcp" : "e.g.: http://localhost:3000/sse"}
                required={serverType === 'sse' || serverType === 'streamable-http'}
              />
            </div>

            <div className="mb-4">
              <div className="flex justify-between items-center mb-2">
                <label className="block text-gray-700 text-sm font-bold">
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
                      className="shadow appearance-none border rounded py-2 px-3 text-gray-700 leading-tight focus:outline-none focus:shadow-outline w-1/2 form-input"
                      placeholder="Authorization"
                    />
                    <span className="flex items-center">:</span>
                    <input
                      type="text"
                      value={headerVar.value}
                      onChange={(e) => handleHeaderVarChange(index, 'value', e.target.value)}
                      className="shadow appearance-none border rounded py-2 px-3 text-gray-700 leading-tight focus:outline-none focus:shadow-outline w-1/2 form-input"
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
        ) : (
          <>
            <div className="mb-4">
              <label className="block text-gray-700 text-sm font-bold mb-2" htmlFor="command">
                {t('server.command')}
              </label>
              <input
                type="text"
                name="command"
                id="command"
                value={formData.command}
                onChange={handleInputChange}
                className="shadow appearance-none border rounded w-full py-2 px-3 text-gray-700 leading-tight focus:outline-none focus:shadow-outline form-input"
                placeholder="e.g.: npx"
                required={serverType === 'stdio'}
              />
            </div>
            <div className="mb-4">
              <label className="block text-gray-700 text-sm font-bold mb-2" htmlFor="arguments">
                {t('server.arguments')}
              </label>
              <input
                type="text"
                name="arguments"
                id="arguments"
                value={formData.arguments}
                onChange={(e) => handleArgsChange(e.target.value)}
                className="shadow appearance-none border rounded w-full py-2 px-3 text-gray-700 leading-tight focus:outline-none focus:shadow-outline form-input"
                placeholder="e.g.: -y time-mcp"
                required={serverType === 'stdio'}
              />
            </div>

            <div className="mb-4">
              <div className="flex justify-between items-center mb-2">
                <label className="block text-gray-700 text-sm font-bold">
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
                      className="shadow appearance-none border rounded py-2 px-3 text-gray-700 leading-tight focus:outline-none focus:shadow-outline w-1/2 form-input"
                      placeholder={t('server.key')}
                    />
                    <span className="flex items-center">:</span>
                    <input
                      type="text"
                      value={envVar.value}
                      onChange={(e) => handleEnvVarChange(index, 'value', e.target.value)}
                      className="shadow appearance-none border rounded py-2 px-3 text-gray-700 leading-tight focus:outline-none focus:shadow-outline w-1/2 form-input"
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
              className="flex items-center justify-between cursor-pointer bg-gray-50 hover:bg-gray-100 p-3 rounded border border-gray-200"
              onClick={() => setIsRequestOptionsExpanded(!isRequestOptionsExpanded)}
            >
              <label className="text-gray-700 text-sm font-bold">
                {t('server.requestOptions')}
              </label>
              <span className="text-gray-500 text-sm">
                {isRequestOptionsExpanded ? '▼' : '▶'}
              </span>
            </div>

            {isRequestOptionsExpanded && (
              <div className="border border-gray-200 rounded-b p-4 bg-gray-50 border-t-0">
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div>
                    <label className="block text-gray-600 text-sm font-medium mb-1" htmlFor="timeout">
                      {t('server.timeout')}
                    </label>
                    <input
                      type="number"
                      id="timeout"
                      value={formData.options?.timeout || 60000}
                      onChange={(e) => handleOptionsChange('timeout', parseInt(e.target.value) || 60000)}
                      className="shadow appearance-none border rounded w-full py-2 px-3 text-gray-700 leading-tight focus:outline-none focus:shadow-outline form-input"
                      placeholder="30000"
                      min="1000"
                      max="300000"
                    />
                    <p className="text-xs text-gray-500 mt-1">{t('server.timeoutDescription')}</p>
                  </div>

                  <div>
                    <label className="block text-gray-600 text-sm font-medium mb-1" htmlFor="maxTotalTimeout">
                      {t('server.maxTotalTimeout')}
                    </label>
                    <input
                      type="number"
                      id="maxTotalTimeout"
                      value={formData.options?.maxTotalTimeout || ''}
                      onChange={(e) => handleOptionsChange('maxTotalTimeout', e.target.value ? parseInt(e.target.value) : undefined)}
                      className="shadow appearance-none border rounded w-full py-2 px-3 text-gray-700 leading-tight focus:outline-none focus:shadow-outline form-input"
                      placeholder="Optional"
                      min="1000"
                    />
                    <p className="text-xs text-gray-500 mt-1">{t('server.maxTotalTimeoutDescription')}</p>
                  </div>
                </div>

                <div className="mt-3">
                  <label className="flex items-center">
                    <input
                      type="checkbox"
                      checked={formData.options?.resetTimeoutOnProgress || false}
                      onChange={(e) => handleOptionsChange('resetTimeoutOnProgress', e.target.checked)}
                      className="mr-2"
                    />
                    <span className="text-gray-600 text-sm">{t('server.resetTimeoutOnProgress')}</span>
                  </label>
                  <p className="text-xs text-gray-500 mt-1 ml-6">
                    {t('server.resetTimeoutOnProgressDescription')}
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
            className="bg-gray-300 hover:bg-gray-400 text-gray-800 font-medium py-2 px-4 rounded mr-2 btn-secondary"
          >
            {t('server.cancel')}
          </button>
          <button
            type="submit"
            className="bg-blue-500 hover:bg-blue-600 text-white font-medium py-2 px-4 rounded btn-primary"
          >
            {isEdit ? t('server.save') : t('server.add')}
          </button>
        </div>
      </form>
    </div>
  )
}

export default ServerForm