import type { ServerConfig, ServerFormData } from '../types';
import { isValidServerName } from './serverName';
import { parseOAuthRelayForm } from './oauthRelayForm';

export type ServerType = 'stdio' | 'sse' | 'streamable-http' | 'openapi';

export type ServerFormTab = 'connection' | 'auth' | 'access' | 'runtime';

export interface ServerFormConfiguredTabs {
  connection: boolean;
  auth: boolean;
  access: boolean;
  runtime: boolean;
}

export interface ServerFormValidationIssue {
  tab: ServerFormTab;
  messageKey: string;
  focusId?: string;
}

export const getAvailableServerFormTabs = (serverType: ServerType): ServerFormTab[] => {
  if (serverType === 'openapi') {
    return ['connection', 'auth', 'access'];
  }
  return ['connection', 'auth', 'access', 'runtime'];
};

export const isValidHttpUrl = (value: string): boolean => {
  const trimmed = value.trim();
  if (!trimmed) return false;
  try {
    const parsed = new URL(trimmed);
    return Boolean(parsed.protocol && parsed.host);
  } catch {
    return false;
  }
};

export const getServerFormConfiguredTabs = ({
  formData,
  serverType,
  relayOrigins = '',
  relayMetadata = '',
}: {
  formData: ServerFormData;
  serverType: ServerType;
  relayOrigins?: string;
  relayMetadata?: string;
}): ServerFormConfiguredTabs => {
  let auth: boolean;

  if (serverType === 'openapi') {
    const isPersonalOAuth = formData.oauth?.identityMode === 'personal';
    auth =
      isPersonalOAuth ||
      Boolean(formData.openapi?.securityType && formData.openapi.securityType !== 'none') ||
      Boolean(formData.openapi?.specSecurityType && formData.openapi.specSecurityType !== 'none') ||
      Boolean(formData.openapi?.cookieSession) ||
      Boolean(formData.openapi?.passthroughHeaders?.trim());
  } else {
    const oauth = formData.oauth;
    const hasOAuth =
      oauth?.identityMode === 'personal' ||
      Boolean(oauth?.clientId?.trim()) ||
      Boolean(oauth?.clientSecret?.trim()) ||
      Boolean(oauth?.allowInsecureTokenEndpoint) ||
      Boolean(oauth?.authorizationRelay) ||
      Boolean(relayOrigins.trim()) ||
      Boolean(relayMetadata.trim());
    const hasPassthrough =
      (serverType === 'sse' || serverType === 'streamable-http') &&
      Boolean(formData.passthroughHeaders?.trim());
    auth = hasOAuth || hasPassthrough;
  }

  const access =
    Boolean(formData.visibility && formData.visibility !== 'private') ||
    (formData.credentialTemplate?.length ?? 0) > 0;

  let runtime = false;
  if (serverType !== 'openapi') {
    const opts = formData.options;
    const hasCustomOptions =
      (opts?.timeout !== undefined && opts.timeout !== 60000) ||
      opts?.maxTotalTimeout !== undefined ||
      opts?.maxBufferSize !== undefined ||
      opts?.resetTimeoutOnProgress === false;
    const hasKeepAlive =
      (serverType === 'sse' || serverType === 'streamable-http') &&
      Boolean(formData.keepAlive?.enabled);
    const hasLifecycle =
      Boolean(formData.perSessionClient) ||
      (serverType === 'stdio' && Boolean(formData.startOnDemand));
    runtime = hasCustomOptions || hasKeepAlive || hasLifecycle;
  }

  return {
    connection: false,
    auth,
    access,
    runtime,
  };
};

export const validateServerForm = ({
  formData,
  serverType,
  initialServerName,
  initialConfig,
  relayOrigins = '',
  relayMetadata = '',
}: {
  formData: ServerFormData;
  serverType: ServerType;
  initialServerName?: string | null;
  initialConfig?: ServerConfig | null;
  relayOrigins?: string;
  relayMetadata?: string;
}): ServerFormValidationIssue | null => {
  const trimmedName = formData.name.trim();
  if (!trimmedName) {
    return {
      tab: 'connection',
      messageKey: 'server.validationNameRequired',
      focusId: 'server-name',
    };
  }

  // Enforce MCP tool-name charset on create and rename; allow no-op edit of legacy names.
  const isNameChanging = !initialServerName || formData.name !== initialServerName;
  if (isNameChanging && !isValidServerName(formData.name)) {
    return {
      tab: 'connection',
      messageKey: 'server.nameInvalid',
      focusId: 'server-name',
    };
  }

  if (serverType === 'stdio') {
    if (!formData.command.trim()) {
      return {
        tab: 'connection',
        messageKey: 'server.validationCommandRequired',
        focusId: 'server-command',
      };
    }
  } else if (serverType === 'sse' || serverType === 'streamable-http') {
    if (!isValidHttpUrl(formData.url)) {
      return {
        tab: 'connection',
        messageKey: 'server.validationUrlRequired',
        focusId: 'server-url',
      };
    }
  } else if (serverType === 'openapi') {
    if (formData.openapi?.inputMode === 'schema') {
      const schema = formData.openapi.schema?.trim() || '';
      if (!schema) {
        return {
          tab: 'connection',
          messageKey: 'server.validationOpenApiSchemaRequired',
          focusId: 'openapi-schema',
        };
      }
      try {
        JSON.parse(schema);
      } catch {
        return {
          tab: 'connection',
          messageKey: 'server.validationOpenApiSchemaInvalid',
          focusId: 'openapi-schema',
        };
      }
    } else if (!isValidHttpUrl(formData.openapi?.url || '')) {
      return {
        tab: 'connection',
        messageKey: 'server.validationOpenApiUrlRequired',
        focusId: 'openapi-url',
      };
    }
  }

  // Auth & Security validations
  if (serverType === 'openapi' && formData.oauth?.identityMode === 'personal') {
    const metadata = formData.oauth.authorizationServerMetadata;
    const clientId = formData.oauth.clientId?.trim() || '';
    const authEndpoint =
      (metadata?.authorization_endpoint ?? formData.oauth.authorizationEndpoint ?? '').trim();
    const tokenEndpoint =
      (metadata?.token_endpoint ?? formData.oauth.tokenEndpoint ?? '').trim();
    if (!clientId || !isValidHttpUrl(authEndpoint) || !isValidHttpUrl(tokenEndpoint)) {
      return {
        tab: 'auth',
        messageKey: 'server.validationPersonalOAuthRequired',
        focusId: 'openapi-personal-oauth-clientId',
      };
    }
  }

  if (
    (serverType === 'sse' || serverType === 'streamable-http') &&
    formData.oauth?.identityMode === 'personal' &&
    formData.oauth?.authorizationRelay
  ) {
    try {
      parseOAuthRelayForm(relayOrigins, relayMetadata);
    } catch (err) {
      return {
        tab: 'auth',
        messageKey:
          err instanceof Error && err.message.startsWith('server.oauth.relay')
            ? err.message
            : 'server.oauth.relayMetadataInvalid',
        focusId:
          err instanceof Error && err.message.includes('Origin')
            ? 'oauthRelayOrigins'
            : 'oauthRelayMetadata',
      };
    }
  }

  // Access & Credential Slots validations
  for (let i = 0; i < (formData.credentialTemplate?.length || 0); i += 1) {
    const slot = formData.credentialTemplate![i];
    if (!slot.name?.trim()) {
      return {
        tab: 'access',
        messageKey: 'server.validationCredentialSlotNameRequired',
        focusId: `credential-slot-name-${i}`,
      };
    }
    if (slot.target === 'url') {
      const hasAllowed = (slot.allowed || []).some((entry) => entry.trim().length > 0);
      if (!hasAllowed) {
        return {
          tab: 'access',
          messageKey: 'server.validationCredentialSlotAllowedRequired',
          focusId: `credential-slot-allowed-${i}`,
        };
      }
    }
  }

  // Runtime & Advanced validations
  // Preserve unchanged stored numeric settings so editing unrelated fields
  // (e.g. description or visibility) never blocks valid persisted configs.
  if (serverType !== 'openapi') {
    const timeout = formData.options?.timeout;
    const isUnchangedTimeout =
      timeout !== undefined && initialConfig?.options?.timeout === timeout;
    if (
      timeout !== undefined &&
      !isUnchangedTimeout &&
      (!Number.isFinite(timeout) || timeout < 1000)
    ) {
      return {
        tab: 'runtime',
        messageKey: 'server.validationTimeoutRange',
        focusId: 'timeout',
      };
    }

    const maxTotalTimeout = formData.options?.maxTotalTimeout;
    const isUnchangedMaxTotal =
      maxTotalTimeout !== undefined && initialConfig?.options?.maxTotalTimeout === maxTotalTimeout;
    if (
      maxTotalTimeout !== undefined &&
      !isUnchangedMaxTotal &&
      (!Number.isFinite(maxTotalTimeout) || maxTotalTimeout < 1000)
    ) {
      return {
        tab: 'runtime',
        messageKey: 'server.validationMaxTotalTimeoutMin',
        focusId: 'maxTotalTimeout',
      };
    }

    const maxBufferSize = formData.options?.maxBufferSize;
    if (
      serverType === 'stdio' &&
      maxBufferSize !== undefined &&
      (!Number.isSafeInteger(maxBufferSize) || maxBufferSize <= 0)
    ) {
      return {
        tab: 'runtime',
        messageKey: 'server.validationMaxBufferSizeMin',
        focusId: 'maxBufferSize',
      };
    }

    if (
      (serverType === 'sse' || serverType === 'streamable-http') &&
      formData.keepAlive?.enabled
    ) {
      const interval = formData.keepAlive.interval;
      const isUnchangedInterval =
        interval !== undefined && initialConfig?.keepAliveInterval === interval;
      if (
        interval !== undefined &&
        !isUnchangedInterval &&
        (!Number.isFinite(interval) || interval < 5000)
      ) {
        return {
          tab: 'runtime',
          messageKey: 'server.validationKeepAliveRange',
          focusId: 'keepAliveInterval',
        };
      }
    }

    if (
      serverType === 'stdio' &&
      (formData.startOnDemand || Boolean(formData.credentialTemplate?.length))
    ) {
      const idleTimeoutMs = formData.idleTimeoutMs;
      const isUnchangedIdleTimeout =
        idleTimeoutMs !== undefined && initialConfig?.idleTimeoutMs === idleTimeoutMs;
      if (
        idleTimeoutMs !== undefined &&
        !isUnchangedIdleTimeout &&
        (!Number.isFinite(idleTimeoutMs) || idleTimeoutMs < 10000)
      ) {
        return {
          tab: 'runtime',
          messageKey: 'server.validationIdleTimeoutMin',
          focusId: 'idleTimeoutMs',
        };
      }
    }
  }

  return null;
};
