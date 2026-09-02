import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { X } from 'lucide-react';
import { Server, EnvVar, ServerFormData, OpenApiToolStats } from '@/types';
import { apiGet, apiPost } from '../utils/fetchInterceptor';
import { buildServerPayload } from '../utils/serverFormPayload';
import {
  deselectShareUsers,
  filterShareUsers,
  getSelectableShareUsers,
  selectShareUsers,
} from '../utils/shareUserSelection.js';
import { OPENAPI_STATS_WARN_TOKENS, formatBytes, formatTokens } from '../utils/contextCost';
import {
  applyDeclaredSecurityPrefill,
  buildOpenApiSecurityNotice,
  type OpenApiSecurityNotice,
} from '../utils/openApiSecurityPrefill';
import {
  getOpenApiSource,
  isOpenApiSourceReady,
  shouldAutoAnalyzeOpenApiSource,
} from '../utils/openApiSourceAnalysis';
import {
  isValidServerName,
  SERVER_NAME_MAX_LENGTH,
  SERVER_NAME_PATTERN,
} from '../utils/serverName';

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

  // Native `pattern`/`maxLength` on the name field are enforced on create and
  // on edit of an already-valid name. Editing a legacy (invalid) name without
  // changing it stays allowed, mirroring the backend create/rename-only rule.
  const enforceNamePattern = !initialData?.name || isValidServerName(initialData.name);

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

  const getInitialCredentialSlots = (
    data: Server | null,
    kind: 'env' | 'headers',
  ): NonNullable<ServerFormData['credentialEnvSlots']> =>
    Object.entries(data?.config?.credentialTemplate?.[kind] || {}).map(([key, slot]) => ({
      key,
      label: slot.label || '',
    }));

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
    credentialEnvSlots: getInitialCredentialSlots(initialData, 'env'),
    credentialHeaderSlots: getInitialCredentialSlots(initialData, 'headers'),
    passthroughHeaders: initialData?.config?.passthroughHeaders?.join(', ') || '',
    visibility: (initialData?.config?.visibility ?? 'private') as 'private' | 'group' | 'public',
    sharedWithUsers: initialData?.config?.sharedWithUsers || [],
    options: {
      timeout:
        (initialData &&
          initialData.config &&
          initialData.config.options &&
          initialData.config.options.timeout) ||
        60000,
      resetTimeoutOnProgress: initialData?.config?.options?.resetTimeoutOnProgress ?? true,
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
    // Per-session client isolation initialization
    perSessionClient: initialData?.config?.perSessionClient === true,
    // Proxychains proxy config: round-trip the stored value so editing the
    // server does not silently drop it (there is no in-form editor for it).
    proxy: initialData?.config?.proxy,
    // On-demand spawning initialization
    startOnDemand: initialData?.config?.startOnDemand === true,
    idleTimeoutMs: initialData?.config?.idleTimeoutMs ?? 300000,
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
            // Spec-download security initialization (#1079)
            specSecurityType: ['apiKey', 'http', 'oauth2'].includes(
              initialData.config.openapi.specSecurity?.type as string,
            )
              ? (initialData.config.openapi.specSecurity!.type as 'apiKey' | 'http' | 'oauth2')
              : 'none',
            specApiKeyName: initialData.config.openapi.specSecurity?.apiKey?.name || '',
            specApiKeyIn: initialData.config.openapi.specSecurity?.apiKey?.in || 'header',
            specApiKeyValue: initialData.config.openapi.specSecurity?.apiKey?.value || '',
            specHttpScheme:
              initialData.config.openapi.specSecurity?.http?.scheme === 'bearer'
                ? 'bearer'
                : 'basic',
            specHttpCredentials: initialData.config.openapi.specSecurity?.http?.credentials || '',
            specOauth2Token: initialData.config.openapi.specSecurity?.oauth2?.token || '',
            // Passthrough headers initialization
            passthroughHeaders: initialData.config.openapi.passthroughHeaders
              ? initialData.config.openapi.passthroughHeaders.join(', ')
              : '',
            cookieSession: initialData.config.openapi.cookieSession === true,
          }
        : {
            inputMode: 'url',
            url: '',
            schema: '',
            version: '3.1.0',
            securityType: 'none',
            specSecurityType: 'none',
            passthroughHeaders: '',
            cookieSession: false,
          },
  });

  const [shareCandidates, setShareCandidates] = useState<string[]>([]);
  const [shareCandidatesLoading, setShareCandidatesLoading] = useState(false);
  const [shareCandidatesError, setShareCandidatesError] = useState(false);
  const [shareUserSearch, setShareUserSearch] = useState('');

  useEffect(() => {
    if (formData.visibility !== 'group' || !initialData?.name) {
      return;
    }

    let cancelled = false;
    setShareCandidatesLoading(true);
    setShareCandidatesError(false);

    void apiGet<{ success: boolean; data?: string[] }>(
      `/servers/${encodeURIComponent(initialData.name)}/share-candidates`,
    )
      .then((response) => {
        if (cancelled) return;

        if (response.success && Array.isArray(response.data)) {
          setShareCandidates(response.data);
        } else {
          setShareCandidatesError(true);
        }
      })
      .catch(() => {
        if (!cancelled) {
          setShareCandidatesError(true);
        }
      })
      .finally(() => {
        if (!cancelled) {
          setShareCandidatesLoading(false);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [formData.visibility, initialData?.name]);

  const selectableShareUsers = getSelectableShareUsers(
    formData.sharedWithUsers || [],
    shareCandidates,
  );
  const filteredShareUsers = filterShareUsers(selectableShareUsers, shareUserSearch);
  const selectedShareUsers = new Set(formData.sharedWithUsers || []);
  const allFilteredShareUsersSelected =
    filteredShareUsers.length > 0 &&
    filteredShareUsers.every((username) => selectedShareUsers.has(username));
  const noFilteredShareUsersSelected =
    filteredShareUsers.length === 0 ||
    filteredShareUsers.every((username) => !selectedShareUsers.has(username));

  const toggleSharedUser = (username: string) => {
    setFormData((previous) => {
      const selected = new Set(previous.sharedWithUsers || []);
      if (selected.has(username)) {
        selected.delete(username);
      } else {
        selected.add(username);
      }
      return { ...previous, sharedWithUsers: Array.from(selected) };
    });
  };

  const selectFilteredShareUsers = () => {
    setFormData((previous) => ({
      ...previous,
      sharedWithUsers: selectShareUsers(previous.sharedWithUsers || [], filteredShareUsers),
    }));
  };

  const deselectFilteredShareUsers = () => {
    setFormData((previous) => ({
      ...previous,
      sharedWithUsers: deselectShareUsers(previous.sharedWithUsers || [], filteredShareUsers),
    }));
  };

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

  // ── OpenAPI source analysis (#1082, #1093) ────────────────────────────────
  // Analyze a new OpenAPI source while the form is being filled. The result is
  // advisory and is shown inline, so submitting the form does not replace the
  // user's current state with a stale async payload.
  const [openApiStats, setOpenApiStats] = useState<OpenApiToolStats | null>(null);
  const [openApiStatsLoading, setOpenApiStatsLoading] = useState(false);
  const [openApiStatsUnavailable, setOpenApiStatsUnavailable] = useState(false);
  const openApiStatsRequestId = useRef(0);
  const analyzedOpenApiSourceKey = useRef<string | null>(null);
  const automaticSecurityAnalysisDone = useRef(false);
  const openApiSecurityTouched = useRef(Boolean(initialData));
  const openApiFormDataRef = useRef(formData);
  openApiFormDataRef.current = formData;
  const openApiEnvVarsRef = useRef(envVars);
  openApiEnvVarsRef.current = envVars;
  const openApiHeaderVarsRef = useRef(headerVars);
  openApiHeaderVarsRef.current = headerVars;
  const [openApiSecurityNotice, setOpenApiSecurityNotice] = useState<OpenApiSecurityNotice | null>(
    null,
  );
  const [securityDetectionLoading, setSecurityDetectionLoading] = useState(false);

  const [isRequestOptionsExpanded, setIsRequestOptionsExpanded] = useState<boolean>(false);
  const [isOAuthSectionExpanded, setIsOAuthSectionExpanded] = useState<boolean>(false);
  const [isKeepAliveSectionExpanded, setIsKeepAliveSectionExpanded] = useState<boolean>(false);
  const [isAdvancedExpanded, setIsAdvancedExpanded] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);
  const isEdit = !!initialData;

  const markOpenApiSecurityTouched = () => {
    openApiSecurityTouched.current = true;
    setOpenApiSecurityNotice(null);
  };

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

  const updateCredentialSlot = (
    kind: 'env' | 'headers',
    index: number,
    field: 'key' | 'label',
    value: string,
  ) => {
    const property = kind === 'env' ? 'credentialEnvSlots' : 'credentialHeaderSlots';
    setFormData((previous) => {
      const slots = [...(previous[property] || [])];
      slots[index] = { ...slots[index], [field]: value };
      return { ...previous, [property]: slots };
    });
  };

  const addCredentialSlot = (kind: 'env' | 'headers') => {
    const property = kind === 'env' ? 'credentialEnvSlots' : 'credentialHeaderSlots';
    setFormData((previous) => ({
      ...previous,
      [property]: [...(previous[property] || []), { key: '', label: '' }],
    }));
  };

  const removeCredentialSlot = (kind: 'env' | 'headers', index: number) => {
    const property = kind === 'env' ? 'credentialEnvSlots' : 'credentialHeaderSlots';
    setFormData((previous) => ({
      ...previous,
      [property]: (previous[property] || []).filter((_, slotIndex) => slotIndex !== index),
    }));
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

  // Shared probe used by automatic source analysis and the explicit retry
  // button. Returns the preview data (including the declared security scheme)
  // or null when the spec cannot be analyzed.
  const runOpenApiSecurityDetection = async (
    payload: ReturnType<typeof buildServerPayload>,
  ): Promise<OpenApiToolStats | null> => {
    try {
      const response = await apiPost<{ success: boolean; data?: OpenApiToolStats }>(
        '/servers/openapi/tool-stats',
        { config: payload.config },
        { signal: AbortSignal.timeout(60000) },
      );
      return response.success && response.data ? response.data : null;
    } catch {
      // The form remains usable when the advisory request fails.
      return null;
    }
  };

  const analyzeOpenApiSource = async (
    payload: ReturnType<typeof buildServerPayload>,
    sourceKey: string,
    options: { allowSecurityPrefill: boolean; consumeAutomaticAnalysis: boolean },
  ) => {
    const requestId = ++openApiStatsRequestId.current;
    setOpenApiStatsLoading(true);
    setOpenApiStatsUnavailable(false);

    const data = await runOpenApiSecurityDetection(payload);
    if (openApiStatsRequestId.current !== requestId) return;

    if (!data) {
      setOpenApiStatsUnavailable(true);
      setOpenApiStatsLoading(false);
      return;
    }

    analyzedOpenApiSourceKey.current = sourceKey;
    setOpenApiStats(data);

    const latestFormData = openApiFormDataRef.current;
    const securityTouched = openApiSecurityTouched.current;
    const declared = data.declaredSecurity;
    const canPrefillSecurity =
      options.allowSecurityPrefill &&
      !securityTouched &&
      !isEdit &&
      !automaticSecurityAnalysisDone.current;

    if (options.consumeAutomaticAnalysis) {
      automaticSecurityAnalysisDone.current = true;
    }

    const nextFormData =
      declared?.declared && declared.supported && canPrefillSecurity
        ? applyDeclaredSecurityPrefill(latestFormData, declared, securityTouched)
        : latestFormData;

    if (nextFormData !== latestFormData) {
      openApiFormDataRef.current = nextFormData;
      setFormData(nextFormData);
    }

    setOpenApiSecurityNotice(
      buildOpenApiSecurityNotice(latestFormData, declared, {
        includeNotDeclared: true,
        securityTouched,
      }),
    );
    setOpenApiStatsLoading(false);
  };

  // Explicit retry button for cases where automatic analysis failed or the
  // user wants to inspect the current source again.
  const detectOpenApiSecurity = async () => {
    setSecurityDetectionLoading(true);
    try {
      const payload = buildServerPayload({ formData, serverType, envVars, headerVars });
      await analyzeOpenApiSource(payload, getOpenApiSource(formData).key, {
        allowSecurityPrefill: !isEdit && !openApiSecurityTouched.current,
        consumeAutomaticAnalysis: false,
      });
    } catch {
      // Advisory only.
    } finally {
      setSecurityDetectionLoading(false);
    }
  };

  const openApiSource = getOpenApiSource(formData);
  const openApiSourcePresent = serverType === 'openapi' && isOpenApiSourceReady(openApiSource);

  useEffect(() => {
    openApiStatsRequestId.current += 1;
    setOpenApiStats(null);
    setOpenApiStatsUnavailable(false);
    setOpenApiStatsLoading(false);
    setOpenApiSecurityNotice(null);

    if (
      !shouldAutoAnalyzeOpenApiSource({
        isEdit,
        serverType,
        source: openApiSource,
        analyzedSourceKey: analyzedOpenApiSourceKey.current,
      })
    ) {
      return;
    }

    setOpenApiStatsLoading(true);
    const timeoutId = window.setTimeout(() => {
      const payload = buildServerPayload({
        formData: openApiFormDataRef.current,
        serverType,
        envVars: openApiEnvVarsRef.current,
        headerVars: openApiHeaderVarsRef.current,
      });
      void analyzeOpenApiSource(payload, openApiSource.key, {
        allowSecurityPrefill: true,
        consumeAutomaticAnalysis: true,
      });
    }, 600);

    return () => {
      window.clearTimeout(timeoutId);
    };
  }, [isEdit, openApiSource.key, serverType]);

  // Submit handler for server configuration
  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    // Server names become part of downstream tool identifiers, so they must
    // satisfy the MCP tool-name charset. Mirror the backend rule: enforce on
    // create and on rename, but let a no-op edit of a legacy (invalid) name
    // through so existing working installations can still be maintained.
    const isNameChanging = !initialData?.name || formData.name !== initialData.name;
    if (isNameChanging && !isValidServerName(formData.name)) {
      setError(t('server.nameInvalid'));
      return;
    }

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
        <button onClick={onCancel} className="hub-icon-btn" aria-label="Close">
          <X size={16} />
        </button>
      </div>

      {(error || formError) && (
        <div className="bg-red-50 text-red-700 p-3 rounded mb-4">{formError || error}</div>
      )}

      <form onSubmit={handleSubmit}>
        {/* ─── Section 1: Basic Info ─── */}
        <div className="mb-5">
          <h3 className="text-sm font-semibold text-[var(--hub-ink)] mb-3 pb-2 border-b border-gray-200 dark:border-gray-700">
            {t('server.sectionBasicInfo', 'Basic Info')}
          </h3>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-4">
            <div className="md:col-span-1">
              <label
                className="block text-sm font-medium mb-1.5 text-[var(--hub-ink-2)]"
                htmlFor="name"
              >
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
                pattern={enforceNamePattern ? SERVER_NAME_PATTERN.source : undefined}
                maxLength={enforceNamePattern ? SERVER_NAME_MAX_LENGTH : undefined}
                title={t('server.nameInvalid')}
                required
              />
              <p className="text-xs text-[var(--hub-ink-3)] mt-1">
                {t('server.nameInvalid')}
              </p>
            </div>

            <div className="md:col-span-2">
              <label
                className="block text-sm font-medium mb-1.5 text-[var(--hub-ink-2)]"
                htmlFor="description"
              >
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
          </div>
        </div>

        {/* ─── Section 2: Connection ─── */}
        <div className="mb-5">
          <h3 className="text-sm font-semibold text-[var(--hub-ink)] mb-3 pb-2 border-b border-gray-200 dark:border-gray-700">
            {t('server.sectionConnection', 'Connection')}
          </h3>

          <div className="mb-4">
            <label className="block text-sm font-medium mb-1.5 text-[var(--hub-ink-2)]">
              {t('server.type')}
            </label>
            <div className="flex flex-wrap gap-x-4 gap-y-2">
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
                <label htmlFor="command" className="text-[var(--hub-ink)]">
                  {t('server.typeStdio')}
                </label>
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
                <label htmlFor="url" className="text-[var(--hub-ink)]">
                  {t('server.typeSse')}
                </label>
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
                <label htmlFor="streamable-http" className="text-[var(--hub-ink)]">
                  {t('server.typeStreamableHttp')}
                </label>
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
                <label htmlFor="openapi" className="text-[var(--hub-ink)]">
                  {t('server.typeOpenapi')}
                </label>
              </div>
            </div>
          </div>

          {/* Connection details — indented to show hierarchy under Server Type */}
          <div className="pl-4 border-l-2 border-gray-200 dark:border-gray-700 ml-2">
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
                      <label htmlFor="input-mode-schema">
                        {t('server.openapi.inputModeSchema')}
                      </label>
                    </div>
                  </div>
                </div>

                {/* URL Input */}
                {formData.openapi?.inputMode === 'url' && (
                  <div className="mb-4">
                    <label
                      className="block text-sm font-medium mb-1.5 text-[var(--hub-ink-2)]"
                      htmlFor="openapi-url"
                    >
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
                      required={
                        serverType === 'openapi' && formData.openapi?.inputMode === 'schema'
                      }
                    />
                    <p className="text-xs text-[var(--hub-ink-3)] mt-1">
                      {t('server.openapi.schemaHelp')}
                    </p>
                  </div>
                )}

                {!isEdit && openApiSourcePresent && (
                  <div
                    className="mb-4 rounded border border-blue-200 bg-blue-50 p-3 text-sm dark:border-blue-900 dark:bg-blue-950/30"
                    aria-live="polite"
                  >
                    {openApiStatsLoading ? (
                      <p className="text-blue-700 dark:text-blue-300">
                        {t('server.openapi.statsMeasuring')}
                      </p>
                    ) : openApiStats ? (
                      <>
                        <p className="font-medium text-blue-900 dark:text-blue-100">
                          {t('server.openapi.statsSummary', {
                            toolCount: openApiStats.toolCount,
                            bytes: formatBytes(openApiStats.definitionsBytes),
                            tokens: formatTokens(openApiStats.estimatedTokens),
                          })}
                        </p>
                        {openApiStats.estimatedTokens >= OPENAPI_STATS_WARN_TOKENS && (
                          <p className="mt-1 text-yellow-700 dark:text-yellow-300">
                            {t('server.openapi.statsWarning')}
                          </p>
                        )}
                      </>
                    ) : openApiStatsUnavailable ? (
                      <p className="text-gray-600 dark:text-gray-300">
                        {t('server.openapi.statsUnavailable')}
                      </p>
                    ) : null}
                  </div>
                )}

                {/* Security Configuration */}
                <div className="mb-4" onChange={markOpenApiSecurityTouched}>
                  <div className="flex items-center justify-between mb-1.5">
                    <label className="block text-sm font-medium text-[var(--hub-ink-2)]">
                      {t('server.openapi.security')}
                    </label>
                    <button
                      type="button"
                      onClick={() => void detectOpenApiSecurity()}
                      disabled={
                        securityDetectionLoading || openApiStatsLoading || !openApiSourcePresent
                      }
                      className="hub-btn text-xs !h-7 !px-2"
                    >
                      {securityDetectionLoading || openApiStatsLoading
                        ? t('server.openapi.securityDetecting')
                        : t('server.openapi.securityDetect')}
                    </button>
                  </div>
                  <select
                    value={formData.openapi?.securityType || 'none'}
                    onChange={(e) =>
                      setFormData((prev) => {
                        setOpenApiSecurityNotice(null);
                        return {
                          ...prev,
                          openapi: {
                            ...prev.openapi,
                            securityType: e.target.value as any,
                            url: prev.openapi?.url || '',
                          },
                        };
                      })
                    }
                    className="w-full py-2 px-3 form-input"
                  >
                    <option value="none">{t('server.openapi.securityNone')}</option>
                    <option value="apiKey">{t('server.openapi.securityApiKey')}</option>
                    <option value="http">{t('server.openapi.securityHttp')}</option>
                    <option value="oauth2">{t('server.openapi.securityOAuth2')}</option>
                    <option value="openIdConnect">
                      {t('server.openapi.securityOpenIdConnect')}
                    </option>
                  </select>
                  {openApiSecurityNotice && (
                    <p
                      className={`mt-2 text-xs ${
                        openApiSecurityNotice.kind === 'warning'
                          ? 'text-yellow-700 dark:text-yellow-300'
                          : 'text-blue-700 dark:text-blue-300'
                      }`}
                    >
                      {t(
                        `server.openapi.${openApiSecurityNotice.messageKey}`,
                        openApiSecurityNotice.values,
                      )}
                    </p>
                  )}
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
                              ? 'user:password or base64'
                              : 'bearer-token'
                          }
                        />
                        {formData.openapi?.httpScheme === 'basic' && (
                          <p className="text-xs text-[var(--hub-ink-3)] mt-1">
                            {t('server.openapi.httpCredentialsBasicHint')}
                          </p>
                        )}
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

                {/* Specification Download Security (#1079) */}
                <div className="mb-4">
                  <div className="flex items-center mb-1">
                    <input
                      type="checkbox"
                      id="openapiSpecSecurity"
                      checked={(formData.openapi?.specSecurityType || 'none') !== 'none'}
                      onChange={(e) =>
                        setFormData((prev) => ({
                          ...prev,
                          openapi: {
                            ...prev.openapi,
                            url: prev.openapi?.url || '',
                            specSecurityType: e.target.checked ? 'http' : 'none',
                          },
                        }))
                      }
                      className="mr-2"
                    />
                    <label
                      htmlFor="openapiSpecSecurity"
                      className="text-gray-700 dark:text-gray-300 text-sm font-medium"
                    >
                      {t('server.openapi.specSecurityToggle')}
                    </label>
                  </div>
                  <p className="text-xs text-gray-500 ml-6">
                    {t('server.openapi.specSecurityHelp')}
                  </p>
                  {(formData.openapi?.specSecurityType || 'none') !== 'none' && (
                    <div className="mt-2 ml-6 p-4 border border-gray-200 dark:border-gray-700 rounded bg-gray-50 dark:bg-gray-800">
                      <div className="mb-3">
                        <label className="block text-xs text-gray-600 mb-1">
                          {t('server.openapi.security')}
                        </label>
                        <select
                          value={formData.openapi?.specSecurityType || 'http'}
                          onChange={(e) =>
                            setFormData((prev) => ({
                              ...prev,
                              openapi: {
                                ...prev.openapi,
                                url: prev.openapi?.url || '',
                                specSecurityType: e.target.value as any,
                              },
                            }))
                          }
                          className="w-full border rounded px-2 py-1 text-sm focus:outline-none form-input"
                        >
                          <option value="http">{t('server.openapi.securityHttp')}</option>
                          <option value="apiKey">{t('server.openapi.securityApiKey')}</option>
                          <option value="oauth2">{t('server.openapi.securityOAuth2')}</option>
                        </select>
                      </div>

                      {formData.openapi?.specSecurityType === 'http' && (
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                          <div>
                            <label className="block text-xs text-gray-600 mb-1">
                              {t('server.openapi.httpScheme')}
                            </label>
                            <select
                              value={formData.openapi?.specHttpScheme || 'basic'}
                              onChange={(e) =>
                                setFormData((prev) => ({
                                  ...prev,
                                  openapi: {
                                    ...prev.openapi,
                                    url: prev.openapi?.url || '',
                                    specHttpScheme: e.target.value as any,
                                  },
                                }))
                              }
                              className="w-full border rounded px-2 py-1 text-sm focus:outline-none form-input"
                            >
                              <option value="basic">{t('server.openapi.httpSchemeBasic')}</option>
                              <option value="bearer">{t('server.openapi.httpSchemeBearer')}</option>
                            </select>
                          </div>
                          <div>
                            <label className="block text-xs text-gray-600 mb-1">
                              {t('server.openapi.httpCredentials')}
                            </label>
                            <input
                              type="password"
                              value={formData.openapi?.specHttpCredentials || ''}
                              onChange={(e) =>
                                setFormData((prev) => ({
                                  ...prev,
                                  openapi: {
                                    ...prev.openapi,
                                    url: prev.openapi?.url || '',
                                    specHttpCredentials: e.target.value,
                                  },
                                }))
                              }
                              className="w-full border rounded px-2 py-1 text-sm focus:outline-none form-input"
                              placeholder={
                                formData.openapi?.specHttpScheme === 'basic'
                                  ? 'user:password or base64'
                                  : 'bearer-token'
                              }
                            />
                          </div>
                        </div>
                      )}

                      {formData.openapi?.specSecurityType === 'apiKey' && (
                        <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                          <div>
                            <label className="block text-xs text-gray-600 mb-1">
                              {t('server.openapi.apiKeyName')}
                            </label>
                            <input
                              type="text"
                              value={formData.openapi?.specApiKeyName || ''}
                              onChange={(e) =>
                                setFormData((prev) => ({
                                  ...prev,
                                  openapi: {
                                    ...prev.openapi,
                                    url: prev.openapi?.url || '',
                                    specApiKeyName: e.target.value,
                                  },
                                }))
                              }
                              className="w-full border rounded px-2 py-1 text-sm focus:outline-none form-input"
                              placeholder="X-API-Key"
                            />
                          </div>
                          <div>
                            <label className="block text-xs text-gray-600 mb-1">
                              {t('server.openapi.apiKeyIn')}
                            </label>
                            <select
                              value={formData.openapi?.specApiKeyIn || 'header'}
                              onChange={(e) =>
                                setFormData((prev) => ({
                                  ...prev,
                                  openapi: {
                                    ...prev.openapi,
                                    url: prev.openapi?.url || '',
                                    specApiKeyIn: e.target.value as any,
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
                              value={formData.openapi?.specApiKeyValue || ''}
                              onChange={(e) =>
                                setFormData((prev) => ({
                                  ...prev,
                                  openapi: {
                                    ...prev.openapi,
                                    url: prev.openapi?.url || '',
                                    specApiKeyValue: e.target.value,
                                  },
                                }))
                              }
                              className="w-full border rounded px-2 py-1 text-sm focus:outline-none form-input"
                            />
                          </div>
                        </div>
                      )}

                      {formData.openapi?.specSecurityType === 'oauth2' && (
                        <div>
                          <label className="block text-xs text-gray-600 mb-1">
                            {t('server.openapi.oauth2Token')}
                          </label>
                          <input
                            type="password"
                            value={formData.openapi?.specOauth2Token || ''}
                            onChange={(e) =>
                              setFormData((prev) => ({
                                ...prev,
                                openapi: {
                                  ...prev.openapi,
                                  url: prev.openapi?.url || '',
                                  specOauth2Token: e.target.value,
                                },
                              }))
                            }
                            className="w-full border rounded px-2 py-1 text-sm focus:outline-none form-input"
                            placeholder="access-token"
                          />
                        </div>
                      )}
                    </div>
                  )}
                </div>

                {/* Cookie Session Handling */}
                <div className="mb-4">
                  <div className="flex items-center mb-1">
                    <input
                      type="checkbox"
                      id="openapiCookieSession"
                      checked={formData.openapi?.cookieSession || false}
                      onChange={(e) =>
                        setFormData((prev) => ({
                          ...prev,
                          openapi: {
                            ...prev.openapi,
                            passthroughHeaders: prev.openapi?.passthroughHeaders || '',
                            url: prev.openapi?.url || '',
                            cookieSession: e.target.checked,
                          },
                        }))
                      }
                      className="mr-2"
                    />
                    <label
                      htmlFor="openapiCookieSession"
                      className="text-gray-700 dark:text-gray-300 text-sm font-medium"
                    >
                      {t('server.openapi.cookieSession', 'Cookie Session Handling')}
                    </label>
                  </div>
                  <p className="text-xs text-gray-500 ml-6">
                    {t(
                      'server.openapi.cookieSessionHelp',
                      'Capture Set-Cookie from upstream login responses and replay them on later calls within the same downstream session. Isolated per MCP session; not persisted.',
                    )}
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
                      className="hub-btn primary !w-[30px] !h-[30px] !p-0 justify-center text-base font-bold"
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
                  <label
                    className="block text-sm font-medium mb-1.5 text-gray-700 dark:text-gray-300"
                    htmlFor="url"
                  >
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
                      className="hub-btn primary !w-[30px] !h-[30px] !p-0 justify-center text-base font-bold"
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
                  <div className="flex justify-between items-center mb-2">
                    <label className="block text-sm font-medium text-gray-700 dark:text-gray-300">
                      {t('server.envVars')}
                    </label>
                    <button
                      type="button"
                      onClick={addEnvVar}
                      className="hub-btn primary !w-[30px] !h-[30px] !p-0 justify-center text-base font-bold"
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
            ) : (
              <>
                <div className="mb-4">
                  <label
                    className="block text-sm font-medium mb-1.5 text-gray-700 dark:text-gray-300"
                    htmlFor="command"
                  >
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
                  <label
                    className="block text-sm font-medium mb-1.5 text-gray-700 dark:text-gray-300"
                    htmlFor="arguments"
                  >
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
                      className="hub-btn primary !w-[30px] !h-[30px] !p-0 justify-center text-base font-bold"
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
          </div>
        </div>

        {/* ─── Section 3: Advanced Options (collapsible) ─── */}
        <div className="mb-4">
          <div
            className="flex items-center justify-between cursor-pointer bg-gray-50 dark:bg-gray-800 hover:bg-gray-100 dark:hover:bg-gray-700 p-3 rounded border border-gray-200 dark:border-gray-700"
            onClick={() => setIsAdvancedExpanded(!isAdvancedExpanded)}
          >
            <h3 className="text-sm font-semibold text-[var(--hub-ink)]">
              {t('server.sectionAdvanced', 'Advanced Options')}
            </h3>
            <span className="text-gray-500 text-sm">{isAdvancedExpanded ? '▼' : '▶'}</span>
          </div>

          {isAdvancedExpanded && (
            <div className="border border-gray-200 dark:border-gray-700 rounded-b p-4 bg-white dark:bg-gray-900 border-t-0 space-y-4">
              {/* Visibility */}
              <div>
                <label
                  className="block text-sm font-medium mb-1.5 text-[var(--hub-ink-2)]"
                  htmlFor="visibility"
                >
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
                  <option value="group">
                    {t('server.visibilityGroup', 'Shared — selected users only')}
                  </option>
                  <option value="public">
                    {t('server.visibilityPublic', 'Public — every authenticated user')}
                  </option>
                </select>
                <p className="text-xs text-gray-500 mt-1">
                  {t(
                    'server.visibilityDescription',
                    'Controls which non-admin users can discover and call this server. Admins always have access.',
                  )}
                </p>

                {formData.visibility === 'group' && (
                  <div className="mt-4 rounded border border-gray-200 dark:border-gray-700 p-3">
                    <div className="text-sm font-medium text-[var(--hub-ink-2)]">
                      {t('server.shareWithUsers', 'Share with users')}
                    </div>
                    <p className="text-xs text-gray-500 mt-1 mb-3">
                      {t(
                        'server.shareWithUsersDescription',
                        'Selected users can discover and call this server, but cannot manage its configuration.',
                      )}
                    </p>

                    {!initialData?.name ? (
                      <p className="text-sm text-gray-500">
                        {t('server.shareAfterCreate', 'Save the server before selecting users.')}
                      </p>
                    ) : (
                      <>
                        {shareCandidatesLoading && (
                          <p className="text-sm text-gray-500">
                            {t('server.shareCandidatesLoading', 'Loading users...')}
                          </p>
                        )}
                        {shareCandidatesError && (
                          <p className="text-sm text-red-600 dark:text-red-400">
                            {t('server.shareCandidatesError', 'Failed to load users.')}
                          </p>
                        )}
                        {!shareCandidatesLoading &&
                          !shareCandidatesError &&
                          selectableShareUsers.length === 0 && (
                            <p className="text-sm text-gray-500">
                              {t('server.noShareCandidates', 'No other users are available.')}
                            </p>
                          )}
                        {selectableShareUsers.length > 0 && (
                          <>
                            <div className="mb-3 space-y-2">
                              <label
                                htmlFor="share-user-search"
                                className="block text-xs font-medium text-[var(--hub-ink-2)]"
                              >
                                {t('server.shareUserSearchLabel', 'Search users')}
                              </label>
                              <input
                                id="share-user-search"
                                type="search"
                                value={shareUserSearch}
                                onChange={(event) => setShareUserSearch(event.target.value)}
                                placeholder={t(
                                  'server.shareUserSearchPlaceholder',
                                  'Search usernames...',
                                )}
                                className="w-full py-2 px-3 form-input text-sm"
                              />
                              <div className="flex flex-wrap gap-2">
                                <button
                                  type="button"
                                  onClick={selectFilteredShareUsers}
                                  disabled={allFilteredShareUsersSelected}
                                  className="hub-btn text-sm"
                                >
                                  {t('server.selectAllShareUsers', 'Select all')}
                                </button>
                                <button
                                  type="button"
                                  onClick={deselectFilteredShareUsers}
                                  disabled={noFilteredShareUsersSelected}
                                  className="hub-btn text-sm"
                                >
                                  {t('server.deselectAllShareUsers', 'Deselect all')}
                                </button>
                              </div>
                            </div>
                            {filteredShareUsers.length === 0 ? (
                              <p className="text-sm text-gray-500">
                                {t('server.noMatchingShareUsers', 'No users match your search.')}
                              </p>
                            ) : (
                              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                                {filteredShareUsers.map((username) => (
                                  <label
                                    key={username}
                                    className="flex items-center gap-2 rounded border border-gray-200 dark:border-gray-700 px-3 py-2 text-sm text-[var(--hub-ink-2)]"
                                  >
                                    <input
                                      type="checkbox"
                                      checked={selectedShareUsers.has(username)}
                                      onChange={() => toggleSharedUser(username)}
                                    />
                                    <span>{username}</span>
                                  </label>
                                ))}
                              </div>
                            )}
                          </>
                        )}
                      </>
                    )}
                  </div>
                )}
              </div>

              {/* Per-user credential template (metadata only; values live in My Credentials). */}
              {serverType !== 'openapi' && (
                <div className="rounded border border-gray-200 dark:border-gray-700 p-3">
                  <div className="text-sm font-medium text-[var(--hub-ink-2)]">
                    {t('server.credentialTemplate.title')}
                  </div>
                  <p className="text-xs text-gray-500 mt-1 mb-3">
                    {t('server.credentialTemplate.description')}
                  </p>

                  {(
                    [
                      {
                        kind: 'env' as const,
                        label: t('server.credentialTemplate.envSlots'),
                        slots: formData.credentialEnvSlots || [],
                      },
                      ...(serverType === 'stdio'
                        ? []
                        : [
                            {
                              kind: 'headers' as const,
                              label: t('server.credentialTemplate.headerSlots'),
                              slots: formData.credentialHeaderSlots || [],
                            },
                          ]),
                    ]
                  ).map(({ kind, label, slots }) => (
                    <div key={kind} className="mb-3 last:mb-0">
                      <div className="flex items-center justify-between mb-2">
                        <label className="text-xs font-medium text-[var(--hub-ink-2)]">
                          {label}
                        </label>
                        <button
                          type="button"
                          onClick={() => addCredentialSlot(kind)}
                          className="hub-btn sm"
                        >
                          + {t('server.add')}
                        </button>
                      </div>
                      {slots.length === 0 ? (
                        <p className="text-xs text-gray-500">
                          {t('server.credentialTemplate.noSlots')}
                        </p>
                      ) : (
                        <div className="space-y-2">
                          {slots.map((slot, index) => (
                            <div key={`${kind}-${index}`} className="flex items-center gap-2">
                              <input
                                type="text"
                                value={slot.key}
                                onChange={(event) =>
                                  updateCredentialSlot(kind, index, 'key', event.target.value)
                                }
                                className="w-1/2 py-2 px-3 form-input"
                                placeholder={
                                  kind === 'env' ? 'PERSONAL_API_TOKEN' : 'Authorization'
                                }
                                aria-label={t('server.credentialTemplate.slotName')}
                              />
                              <input
                                type="text"
                                value={slot.label}
                                onChange={(event) =>
                                  updateCredentialSlot(kind, index, 'label', event.target.value)
                                }
                                className="w-1/2 py-2 px-3 form-input"
                                placeholder={t('server.credentialTemplate.labelPlaceholder')}
                                aria-label={t('server.credentialTemplate.slotLabel')}
                              />
                              <button
                                type="button"
                                onClick={() => removeCredentialSlot(kind, index)}
                                className="hub-btn sm"
                                aria-label={t('common.delete')}
                              >
                                −
                              </button>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              )}

              {/* Passthrough Headers Configuration */}
              <div>
                <label className="block text-sm font-medium mb-1.5 text-[var(--hub-ink-2)]">
                  {t('server.openapi.passthroughHeaders')}
                </label>
                {serverType === 'openapi' ? (
                  <>
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
                  </>
                ) : (
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
                )}
                <p className="text-xs text-gray-500 mt-1">
                  {t('server.openapi.passthroughHeadersHelp')}
                </p>
              </div>

              {/* OAuth Configuration - non-OpenAPI types */}
              {serverType !== 'openapi' && (
                <div>
                  <div
                    className="flex items-center justify-between cursor-pointer bg-gray-50 dark:bg-gray-800 hover:bg-gray-100 dark:hover:bg-gray-700 p-3 rounded border border-gray-200 dark:border-gray-700"
                    onClick={() => setIsOAuthSectionExpanded(!isOAuthSectionExpanded)}
                  >
                    <label className="text-sm font-medium text-gray-700 dark:text-gray-300">
                      {t('server.oauth.sectionTitle')}
                    </label>
                    <span className="text-gray-500 text-sm">
                      {isOAuthSectionExpanded ? '▼' : '▶'}
                    </span>
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
                      </div>
                    </div>
                  )}
                </div>
              )}

              {/* Request Options Configuration */}
              {serverType !== 'openapi' && (
                <div>
                  <div
                    className="flex items-center justify-between cursor-pointer bg-gray-50 dark:bg-gray-800 hover:bg-gray-100 p-3 rounded border border-gray-200 dark:border-gray-700"
                    onClick={() => setIsRequestOptionsExpanded(!isRequestOptionsExpanded)}
                  >
                    <label className="text-sm font-medium text-gray-700 dark:text-gray-300">
                      {t('server.requestOptions')}
                    </label>
                    <span className="text-gray-500 text-sm">
                      {isRequestOptionsExpanded ? '▼' : '▶'}
                    </span>
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
                          <p className="text-xs text-gray-500 mt-1">
                            {t('server.timeoutDescription')}
                          </p>
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
                <div>
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

              {/* Per-session client isolation - applies to any server type except openapi */}
              {serverType !== 'openapi' && (
                <div>
                  <div className="flex items-center mb-1">
                    <input
                      type="checkbox"
                      id="perSessionClient"
                      checked={formData.perSessionClient || false}
                      onChange={(e) =>
                        setFormData((prev) => ({
                          ...prev,
                          perSessionClient: e.target.checked,
                        }))
                      }
                      className="mr-2"
                    />
                    <label
                      htmlFor="perSessionClient"
                      className="text-gray-700 dark:text-gray-300 text-sm font-medium"
                    >
                      {t('server.perSessionClient', 'Per-Session Client Isolation')}
                    </label>
                  </div>
                  <p className="text-xs text-gray-500 ml-6">
                    {t(
                      'server.perSessionClientDescription',
                      'Create a dedicated upstream connection per session instead of sharing one across all sessions. Enable for stateful servers like Playwright. Increases upstream connections with concurrent sessions.',
                    )}
                  </p>
                </div>
              )}

              {/* On-demand spawning - stdio only */}
              {serverType === 'stdio' && (
                <div>
                  <div className="flex items-center mb-1">
                    <input
                      type="checkbox"
                      id="startOnDemand"
                      checked={formData.startOnDemand || false}
                      onChange={(e) =>
                        setFormData((prev) => ({
                          ...prev,
                          startOnDemand: e.target.checked,
                        }))
                      }
                      className="mr-2"
                    />
                    <label
                      htmlFor="startOnDemand"
                      className="text-gray-700 dark:text-gray-300 text-sm font-medium"
                    >
                      {t('server.startOnDemand', 'Start On Demand')}
                    </label>
                  </div>
                  <p className="text-xs text-gray-500 ml-6">
                    {t(
                      'server.startOnDemandDescription',
                      'Skip startup connect and spawn this server only when a tool call arrives. The process is shut down automatically after the idle timeout, then restarted on the next call. Reduces persistent memory usage for rarely-used servers.',
                    )}
                  </p>
                  {formData.startOnDemand && (
                    <div className="ml-6 mt-2">
                      <label
                        htmlFor="idleTimeoutMs"
                        className="block text-xs text-gray-600 dark:text-gray-400 mb-1"
                      >
                        {t('server.idleTimeoutMs', 'Idle shutdown timeout (ms)')}
                      </label>
                      <input
                        type="number"
                        id="idleTimeoutMs"
                        min={10000}
                        step={1000}
                        value={formData.idleTimeoutMs ?? 300000}
                        onChange={(e) =>
                          setFormData((prev) => ({
                            ...prev,
                            idleTimeoutMs: Number(e.target.value),
                          }))
                        }
                        className="hub-input w-40 text-sm"
                      />
                      <p className="text-xs text-gray-500 mt-1">
                        {t(
                          'server.idleTimeoutMsDescription',
                          'Shut down the process after this many milliseconds with no tool calls. Default: 300000 (5 minutes).',
                        )}
                      </p>
                    </div>
                  )}
                </div>
              )}
            </div>
          )}
        </div>

        <div className="flex justify-end mt-6">
          <button type="button" onClick={onCancel} className="hub-btn mr-2">
            {t('server.cancel')}
          </button>
          <button type="submit" className="hub-btn primary">
            {isEdit ? t('server.save') : t('server.add')}
          </button>
        </div>
      </form>
    </div>
  );
};

export default ServerForm;
