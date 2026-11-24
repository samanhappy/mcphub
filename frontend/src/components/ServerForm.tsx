import { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  AlertCircle,
  Plug,
  Shield,
  SlidersHorizontal,
  Users,
  X,
} from 'lucide-react';
import { useAuth } from '../contexts/AuthContext';
import { useServerContext } from '../contexts/ServerContext';
import { getServerTagOptions, normalizeTags } from '../utils/serverTags';
import { getServerConfigPermissionError } from '../utils/serverPermissions.js';
import type { Server, EnvVar, ServerFormData, OpenApiToolStats } from '@/types';
import { apiGet, apiPost } from '../utils/fetchInterceptor';
import { parseOAuthRelayForm } from '../utils/oauthRelayForm';
import { buildServerPayload } from '../utils/serverFormPayload';
import {
  deselectShareUsers,
  filterShareUsers,
  getSelectableShareUsers,
  selectShareUsers,
} from '../utils/shareUserSelection.js';
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
import { isValidServerName } from '../utils/serverName';
import {
  getAvailableServerFormTabs,
  getServerFormSectionBadges,
  validateServerForm,
  type ServerFormTab,
  type ServerType,
} from '../utils/serverFormUi';
import { ConnectionSection } from './server-form/ConnectionSection';
import { AuthSection } from './server-form/AuthSection';
import { AccessSection } from './server-form/AccessSection';
import { RuntimeSection } from './server-form/RuntimeSection';

interface ServerFormProps {
  onSubmit: (payload: any) => void | Promise<void>;
  onCancel: () => void;
  initialData?: Server | null;
  modalTitle: string;
  formError?: string | null;
  onClearFormError?: () => void;
  isSubmitting?: boolean;
  /**
   * Which flow this form drives. `initialData` pre-fills the form for the edit
   * flow *and* for create flows that start from an existing configuration
   * (marketplace/registry install, duplicate), so it cannot decide this on its
   * own: it defaults to 'edit' when `initialData` is set, matching the install
   * forms, and callers that create a server pass 'create' explicitly.
   */
  mode?: 'create' | 'edit';
  /**
   * Server whose share candidates the visibility picker loads. Defaults to
   * `initialData.name`, which is right for the edit flow; the duplicate flow
   * points it at the source server because the copy does not exist yet (#1187).
   */
  shareCandidatesFrom?: string | null;
}

const ServerForm = ({
  onSubmit,
  onCancel,
  initialData = null,
  modalTitle,
  formError = null,
  onClearFormError,
  isSubmitting: externalSubmitting = false,
  mode,
  shareCandidatesFrom = null,
}: ServerFormProps) => {
  const { t } = useTranslation();
  const { auth } = useAuth();
  const { allServers } = useServerContext();
  const titleId = useId();
  const formId = useId();
  const contentRef = useRef<HTMLDivElement>(null);

  const tagSuggestions = useMemo(
    () => getServerTagOptions(allServers).map((option) => option.tag),
    [allServers],
  );

  // Native `pattern`/`maxLength` on the name field are enforced on create and
  // on edit of an already-valid name. Editing a legacy (invalid) name without
  // changing it stays allowed, mirroring the backend create/rename-only rule.
  const enforceNamePattern = !initialData?.name || isValidServerName(initialData.name);

  const getInitialServerType = (): ServerType => {
    if (!initialData || !initialData.config) return 'stdio';

    if (initialData.config.type) {
      return initialData.config.type;
    } else if (initialData.config.url) {
      return 'sse';
    } else {
      return 'stdio';
    }
  };

  const getInitialServerEnvVars = (data: Server | null): EnvVar[] => {
    if (!data || !data.config || !data.config.env) return [];

    return Object.entries(data.config.env).map(([key, value]) => ({
      key,
      value,
      description: '',
    }));
  };

  const getInitialOAuthConfig = (data: Server | null): ServerFormData['oauth'] => {
    const oauth = data?.config?.oauth;

    return {
      identityMode: oauth?.identityMode || 'shared',
      clientId: oauth?.clientId || '',
      ...(oauth?.allowInsecureTokenEndpoint !== undefined && {
        allowInsecureTokenEndpoint: oauth.allowInsecureTokenEndpoint,
      }),
      clientSecret: oauth?.clientSecret || '',
      scopes: oauth?.scopes ? oauth.scopes.join(' ') : '',
      accessToken: oauth?.accessToken || '',
      accessTokenExpiresAt: oauth?.accessTokenExpiresAt,
      refreshToken: oauth?.refreshToken || '',
      authorizationEndpoint: oauth?.authorizationEndpoint || '',
      tokenEndpoint: oauth?.tokenEndpoint || '',
      resource: oauth?.resource || '',
      // Faithful pass-through (#F1): carry non-editable OAuth sub-fields through round-trip.
      ...(oauth?.authorizationRelay && { authorizationRelay: oauth.authorizationRelay }),
      ...(oauth?.authorizationServerMetadata && {
        authorizationServerMetadata: oauth.authorizationServerMetadata,
      }),
      ...(oauth?.dynamicRegistration && { dynamicRegistration: oauth.dynamicRegistration }),
      ...(oauth?.revocationEndpoint && { revocationEndpoint: oauth.revocationEndpoint }),
      ...(oauth?.redirectUri && { redirectUri: oauth.redirectUri }),
    };
  };

  const [serverType, setServerType] = useState<ServerType>(getInitialServerType());
  const [activeTab, setActiveTab] = useState<ServerFormTab>('connection');
  const [isDirty, setIsDirty] = useState(false);
  const [confirmDiscard, setConfirmDiscard] = useState(false);
  const [localSubmitting, setLocalSubmitting] = useState(false);

  const [formData, setFormData] = useState<ServerFormData>({
    name: (initialData && initialData.name) || '',
    description: (initialData && initialData.config && initialData.config.description) || '',
    tags: normalizeTags(initialData?.config?.tags),
    url: (initialData && initialData.config && initialData.config.url) || '',
    command: (initialData && initialData.config && initialData.config.command) || '',
    arguments: '',
    args: (initialData && initialData.config && initialData.config.args) || [],
    type: getInitialServerType(),
    env: getInitialServerEnvVars(initialData),
    headers: [],
    passthroughHeaders: initialData?.config?.passthroughHeaders?.join(', ') || '',
    visibility: (initialData?.config?.visibility ?? 'private') as 'private' | 'group' | 'public',
    sharedWithUsers: initialData?.config?.sharedWithUsers || [],
    sharedWithUserGroups: initialData?.config?.sharedWithUserGroups || [],
    options: {
      maxBufferSize: initialData?.config?.options?.maxBufferSize,
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
    keepAlive: {
      enabled: initialData?.config?.enableKeepAlive === true,
      interval: initialData?.config?.keepAliveInterval || 60000,
    },
    perSessionClient: initialData?.config?.perSessionClient === true,
    protocolNegotiation: initialData?.config?.protocolNegotiation,
    credentialTemplate: initialData?.config?.credentialTemplate || [],
    // Round-trip non-editable stored values so edits do not drop them.
    proxy: initialData?.config?.proxy,
    tools: initialData?.config?.tools,
    staging: initialData?.config?.staging,
    startOnDemand: initialData?.config?.startOnDemand === true,
    idleTimeoutMs: initialData?.config?.idleTimeoutMs ?? 300000,
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
            apiKeyName: initialData.config.openapi.security?.apiKey?.name || '',
            apiKeyIn: initialData.config.openapi.security?.apiKey?.in || 'header',
            apiKeyValue: initialData.config.openapi.security?.apiKey?.value || '',
            httpScheme: initialData.config.openapi.security?.http?.scheme || 'bearer',
            httpCredentials: initialData.config.openapi.security?.http?.credentials || '',
            oauth2TokenUrl: initialData.config.openapi.security?.oauth2?.tokenUrl || '',
            oauth2ClientId: initialData.config.openapi.security?.oauth2?.clientId || '',
            oauth2ClientSecret: initialData.config.openapi.security?.oauth2?.clientSecret || '',
            oauth2Token: initialData.config.openapi.security?.oauth2?.token || '',
            openIdConnectUrl: initialData.config.openapi.security?.openIdConnect?.url || '',
            openIdConnectToken: initialData.config.openapi.security?.openIdConnect?.token || '',
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
            specHttpScheme: 'basic',
            passthroughHeaders: '',
            cookieSession: false,
          },
  });

  const [shareCandidates, setShareCandidates] = useState<string[]>([]);
  const [shareUserGroups, setShareUserGroups] = useState<string[]>([]);
  const [shareCandidatesLoading, setShareCandidatesLoading] = useState(false);
  const [shareCandidatesError, setShareCandidatesError] = useState(false);
  const [shareUserSearch, setShareUserSearch] = useState('');

  const shareCandidatesServer = shareCandidatesFrom || initialData?.name;

  useEffect(() => {
    if (formData.visibility !== 'group' || !shareCandidatesServer) {
      return;
    }

    let cancelled = false;
    setShareCandidatesLoading(true);
    setShareCandidatesError(false);

    void apiGet<{ success: boolean; data?: string[]; userGroups?: string[] }>(
      `/servers/${encodeURIComponent(shareCandidatesServer)}/share-candidates`,
    )
      .then((response) => {
        if (cancelled) return;

        if (response.success && Array.isArray(response.data)) {
          setShareCandidates(response.data);
          setShareUserGroups(response.userGroups || []);
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
  }, [formData.visibility, shareCandidatesServer]);

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

  // OpenAPI source analysis (#1082, #1093)
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

  const [relayOrigins, setRelayOrigins] = useState(
    initialData?.config?.oauth?.authorizationRelay?.allowedRedirectOrigins.join('\n') || '',
  );
  const [relayMetadata, setRelayMetadata] = useState(
    initialData?.config?.oauth?.authorizationServerMetadata
      ? JSON.stringify(initialData.config.oauth!.authorizationServerMetadata, null, 2)
      : '',
  );
  const [error, setError] = useState<string | null>(null);
  const isEdit = mode ? mode === 'edit' : Boolean(initialData);
  const isSubmitting = externalSubmitting || localSubmitting;
  const isAdmin = auth.user?.isAdmin === true;

  const availableTabs = useMemo(() => getAvailableServerFormTabs(serverType), [serverType]);
  const badges = useMemo(
    () => getServerFormSectionBadges({ formData, serverType, relayOrigins, relayMetadata }),
    [formData, serverType, relayOrigins, relayMetadata],
  );

  // Ensure activeTab remains valid when switching to OpenAPI (which has no runtime tab).
  useEffect(() => {
    if (!availableTabs.includes(activeTab)) {
      setActiveTab('connection');
    }
  }, [availableTabs, activeTab]);

  const handleRequestClose = useCallback(() => {
    if (isSubmitting) return;
    if (isDirty && !confirmDiscard) {
      setConfirmDiscard(true);
      return;
    }
    onCancel();
  }, [isSubmitting, isDirty, confirmDiscard, onCancel]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.stopPropagation();
        handleRequestClose();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [handleRequestClose]);

  const handleFieldMutated = useCallback(() => {
    setIsDirty(true);
    setConfirmDiscard(false);
    setError(null);
    onClearFormError?.();
  }, [onClearFormError]);

  const handleTabChange = (tab: ServerFormTab) => {
    setActiveTab(tab);
    if (contentRef.current) {
      contentRef.current.scrollTop = 0;
    }
  };

  const markOpenApiSecurityTouched = () => {
    openApiSecurityTouched.current = true;
    setOpenApiSecurityNotice(null);
  };

  const updateServerType = (type: ServerType) => {
    setServerType(type);
    setFormData((prev) => ({ ...prev, type }));
  };

  const handleEnvVarChange = (index: number, field: 'key' | 'value', value: string) => {
    setEnvVars((prev) =>
      prev.map((item, i) => (i === index ? { ...item, [field]: value } : item)),
    );
  };

  const addEnvVar = () => {
    setEnvVars((prev) => [...prev, { key: '', value: '' }]);
  };

  const removeEnvVar = (index: number) => {
    setEnvVars((prev) => prev.filter((_, i) => i !== index));
  };

  const handleHeaderVarChange = (index: number, field: 'key' | 'value', value: string) => {
    setHeaderVars((prev) =>
      prev.map((item, i) => (i === index ? { ...item, [field]: value } : item)),
    );
  };

  const addHeaderVar = () => {
    setHeaderVars((prev) => [...prev, { key: '', value: '' }]);
  };

  const removeHeaderVar = (index: number) => {
    setHeaderVars((prev) => prev.filter((_, i) => i !== index));
  };

  const handleOAuthChange = <K extends keyof NonNullable<ServerFormData['oauth']>>(
    field: K,
    value: NonNullable<ServerFormData['oauth']>[K],
  ) => {
    setFormData((prev) => ({
      ...prev,
      oauth: {
        ...(prev.oauth || {}),
        [field]: value,
      },
    }));
  };

  const handleOptionsChange = (
    field: 'timeout' | 'resetTimeoutOnProgress' | 'maxTotalTimeout' | 'maxBufferSize',
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

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (isSubmitting) return;

    setError(null);
    setConfirmDiscard(false);

    // Normalize numeric defaults before validation & payload assembly.
    const normalizedFormData: ServerFormData = {
      ...formData,
      options: {
        ...formData.options,
        timeout:
          formData.options?.timeout === undefined || Number.isNaN(formData.options.timeout)
            ? 60000
            : formData.options.timeout,
      },
      keepAlive: {
        ...formData.keepAlive,
        interval:
          formData.keepAlive?.interval === undefined || Number.isNaN(formData.keepAlive.interval)
            ? 60000
            : formData.keepAlive.interval,
      },
      idleTimeoutMs:
        formData.idleTimeoutMs === undefined || Number.isNaN(formData.idleTimeoutMs)
          ? 300000
          : formData.idleTimeoutMs,
    };

    const validationIssue = validateServerForm({
      formData: normalizedFormData,
      serverType,
      initialServerName: initialData?.name,
      relayOrigins,
      relayMetadata,
    });

    if (validationIssue) {
      setActiveTab(validationIssue.tab);
      setError(t(validationIssue.messageKey));
      if (validationIssue.focusId) {
        window.requestAnimationFrame(() => {
          const target = document.getElementById(validationIssue.focusId!);
          target?.focus();
          target?.scrollIntoView({ behavior: 'smooth', block: 'center' });
        });
      }
      return;
    }

    try {
      const payload = buildServerPayload({
        formData: normalizedFormData.oauth?.authorizationRelay
          ? {
              ...normalizedFormData,
              oauth: {
                ...normalizedFormData.oauth,
                ...parseOAuthRelayForm(relayOrigins, relayMetadata),
              },
            }
          : normalizedFormData,
        serverType,
        envVars,
        headerVars,
      });

      const permissionError = getServerConfigPermissionError(payload.config, auth.user?.isAdmin);
      if (permissionError) {
        setError(t(permissionError));
        return;
      }

      setLocalSubmitting(true);
      await Promise.resolve(onSubmit(payload));
    } catch (err) {
      setError(
        err instanceof Error && err.message.startsWith('server.oauth.relay')
          ? t(err.message)
          : `Error: ${err instanceof Error ? err.message : String(err)}`,
      );
    } finally {
      setLocalSubmitting(false);
    }
  };

  const navItems: Array<{
    id: ServerFormTab;
    label: string;
    icon: typeof Plug;
    badge: number;
  }> = [
    {
      id: 'connection',
      label: t('server.tabConnection', 'Basic & Connection'),
      icon: Plug,
      badge: badges.connection,
    },
    {
      id: 'auth',
      label: t('server.tabAuth', 'Auth & Security'),
      icon: Shield,
      badge: badges.auth,
    },
    {
      id: 'access',
      label: t('server.tabAccess', 'Access & Credentials'),
      icon: Users,
      badge: badges.access,
    },
    {
      id: 'runtime',
      label: t('server.tabRuntime', 'Runtime & Advanced'),
      icon: SlidersHorizontal,
      badge: badges.runtime,
    },
  ].filter((item) => availableTabs.includes(item.id));

  const transportBadgeLabel =
    serverType === 'stdio'
      ? t('server.typeStdio')
      : serverType === 'streamable-http'
        ? t('server.typeStreamableHttp')
        : serverType === 'sse'
          ? t('server.typeSse')
          : t('server.typeOpenapi');

  const activeError = error || formError;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby={titleId}
      className="hub-server-modal"
    >
      {/* Fixed Header */}
      <div
        className="flex items-center justify-between gap-3 px-5 py-3.5 flex-shrink-0"
        style={{
          borderBottom: '1px solid var(--hub-line)',
          background: 'var(--hub-surface)',
        }}
      >
        <div className="flex items-center gap-2.5 min-w-0">
          <h2 id={titleId} className="text-[15px] font-semibold text-[var(--hub-ink)] truncate">
            {modalTitle}
          </h2>
          <span className="hub-tag flex-shrink-0">{transportBadgeLabel}</span>
        </div>
        <button
          type="button"
          onClick={handleRequestClose}
          disabled={isSubmitting}
          className="hub-icon-btn sm flex-shrink-0"
          aria-label={t('app.closeButton', 'Close')}
        >
          <X size={15} />
        </button>
      </div>

      {/* Middle: Left Navigation Rail + Independent Scrollable Content Pane */}
      <form
        id={formId}
        noValidate
        onSubmit={handleSubmit}
        className="flex-1 min-h-0 flex flex-col md:flex-row overflow-hidden"
      >
        <nav
          role="tablist"
          aria-label={modalTitle}
          className="hub-server-nav flex md:flex-col gap-1 p-2.5 md:p-3 border-b md:border-b-0 md:border-r md:w-[216px] flex-shrink-0 overflow-x-auto md:overflow-y-auto"
        >
          {navItems.map(({ id, label, icon: Icon, badge }) => {
            const selected = activeTab === id;
            return (
              <button
                key={id}
                type="button"
                role="tab"
                aria-selected={selected}
                aria-controls={`${formId}-panel-${id}`}
                id={`${formId}-tab-${id}`}
                onClick={() => handleTabChange(id)}
                className="hub-server-nav-item"
              >
                <span className="flex items-center gap-2 min-w-0">
                  <Icon size={14} className="flex-shrink-0 opacity-80" />
                  <span className="truncate">{label}</span>
                </span>
                {badge > 0 && (
                  <span
                    className="hub-server-nav-badge"
                    aria-label={`${badge} ${t('server.configured', 'Configured')}`}
                  >
                    {badge}
                  </span>
                )}
              </button>
            );
          })}
        </nav>

        <div
          ref={contentRef}
          role="tabpanel"
          id={`${formId}-panel-${activeTab}`}
          aria-labelledby={`${formId}-tab-${activeTab}`}
          className="flex-1 min-w-0 overflow-y-auto p-4 md:p-5"
          style={{ background: 'var(--hub-bg)' }}
        >
          {activeTab === 'connection' && (
            <ConnectionSection
              formData={formData}
              setFormData={setFormData}
              serverType={serverType}
              onServerTypeChange={updateServerType}
              isAdmin={isAdmin}
              isEdit={isEdit}
              enforceNamePattern={enforceNamePattern}
              tagSuggestions={tagSuggestions}
              envVars={envVars}
              onAddEnvVar={addEnvVar}
              onEnvVarChange={handleEnvVarChange}
              onRemoveEnvVar={removeEnvVar}
              headerVars={headerVars}
              onAddHeaderVar={addHeaderVar}
              onHeaderVarChange={handleHeaderVarChange}
              onRemoveHeaderVar={removeHeaderVar}
              openApiSourcePresent={openApiSourcePresent}
              openApiStats={openApiStats}
              openApiStatsLoading={openApiStatsLoading}
              openApiStatsUnavailable={openApiStatsUnavailable}
              onFieldMutated={handleFieldMutated}
            />
          )}

          {activeTab === 'auth' && (
            <AuthSection
              formData={formData}
              setFormData={setFormData}
              serverType={serverType}
              isAdmin={isAdmin}
              openApiSourcePresent={openApiSourcePresent}
              openApiStatsLoading={openApiStatsLoading}
              securityDetectionLoading={securityDetectionLoading}
              openApiSecurityNotice={openApiSecurityNotice}
              onDetectOpenApiSecurity={() => void detectOpenApiSecurity()}
              onMarkOpenApiSecurityTouched={markOpenApiSecurityTouched}
              onOAuthChange={handleOAuthChange}
              relayOrigins={relayOrigins}
              setRelayOrigins={setRelayOrigins}
              relayMetadata={relayMetadata}
              setRelayMetadata={setRelayMetadata}
              onFieldMutated={handleFieldMutated}
            />
          )}

          {activeTab === 'access' && (
            <AccessSection
              formData={formData}
              setFormData={setFormData}
              serverType={serverType}
              shareCandidatesServer={shareCandidatesServer}
              shareUserGroups={shareUserGroups}
              shareCandidatesLoading={shareCandidatesLoading}
              shareCandidatesError={shareCandidatesError}
              selectableShareUsers={selectableShareUsers}
              filteredShareUsers={filteredShareUsers}
              selectedShareUsers={selectedShareUsers}
              shareUserSearch={shareUserSearch}
              setShareUserSearch={setShareUserSearch}
              allFilteredShareUsersSelected={allFilteredShareUsersSelected}
              noFilteredShareUsersSelected={noFilteredShareUsersSelected}
              onToggleSharedUser={toggleSharedUser}
              onSelectFilteredShareUsers={selectFilteredShareUsers}
              onDeselectFilteredShareUsers={deselectFilteredShareUsers}
              onFieldMutated={handleFieldMutated}
            />
          )}

          {activeTab === 'runtime' && serverType !== 'openapi' && (
            <RuntimeSection
              formData={formData}
              setFormData={setFormData}
              serverType={serverType}
              onOptionsChange={handleOptionsChange}
              onFieldMutated={handleFieldMutated}
            />
          )}
        </div>
      </form>

      {/* Persistent Error Banner above Footer (always visible regardless of scroll) */}
      {activeError && (
        <div
          role="alert"
          className="error-box mx-5 my-2.5 px-3 py-2 flex items-center gap-2 text-xs flex-shrink-0"
        >
          <AlertCircle size={14} className="flex-shrink-0" />
          <span className="flex-1 min-w-0 break-words">{activeError}</span>
        </div>
      )}

      {/* Fixed Footer */}
      <div
        className="flex flex-wrap items-center justify-between gap-3 px-5 py-3 flex-shrink-0"
        style={{
          borderTop: '1px solid var(--hub-line)',
          background: 'var(--hub-surface)',
        }}
      >
        <div className="min-w-0 flex-1">
          {confirmDiscard && (
            <div className="flex flex-wrap items-center gap-2 text-xs text-amber-700 dark:text-amber-300">
              <span>
                {t(
                  'server.unsavedChangesConfirm',
                  'You have unsaved changes. Discard them and close?',
                )}
              </span>
              <button
                type="button"
                onClick={() => setConfirmDiscard(false)}
                className="hub-btn sm"
              >
                {t('server.cancel')}
              </button>
              <button type="button" onClick={onCancel} className="hub-btn sm danger">
                {t('app.closeButton', 'Close')}
              </button>
            </div>
          )}
        </div>

        <div className="flex items-center gap-2 flex-shrink-0">
          <button
            type="button"
            onClick={handleRequestClose}
            disabled={isSubmitting}
            className="hub-btn"
          >
            {t('server.cancel')}
          </button>
          <button
            type="submit"
            form={formId}
            disabled={isSubmitting}
            className={`hub-btn primary ${isSubmitting ? 'is-loading' : ''}`}
          >
            {isSubmitting
              ? isEdit
                ? t('server.saving', 'Saving…')
                : t('server.adding', 'Adding…')
              : isEdit
                ? t('server.save')
                : t('server.add')}
          </button>
        </div>
      </div>
    </div>
  );
};

export default ServerForm;
