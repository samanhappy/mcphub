import type { ServerFormData } from '../types';
import { isValidServerName } from './serverName';
import { parseOAuthRelayForm } from './oauthRelayForm';

export type ServerType = 'stdio' | 'sse' | 'streamable-http' | 'openapi';

export type ServerFormTab = 'connection' | 'auth' | 'access' | 'runtime';

export interface ServerFormSectionBadges {
  connection: number;
  auth: number;
  access: number;
  runtime: number;
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

export const getServerFormSectionBadges = ({
  formData,
  serverType,
  relayOrigins = '',
  relayMetadata = '',
}: {
  formData: ServerFormData;
  serverType: ServerType;
  relayOrigins?: string;
  relayMetadata?: string;
}): ServerFormSectionBadges => {
  let authCount = 0;

  if (serverType === 'openapi') {
    const isPersonalOAuth = formData.oauth?.identityMode === 'personal';
    if (isPersonalOAuth || (formData.openapi?.securityType && formData.openapi.securityType !== 'none')) {
      authCount += 1;
    }
    if (formData.openapi?.specSecurityType && formData.openapi.specSecurityType !== 'none') {
      authCount += 1;
    }
    if (formData.openapi?.cookieSession) {
      authCount += 1;
    }
    if (formData.openapi?.passthroughHeaders?.trim()) {
      authCount += 1;
    }
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
    if (hasOAuth) {
      authCount += 1;
    }
    if (
      (serverType === 'sse' || serverType === 'streamable-http') &&
      formData.passthroughHeaders?.trim()
    ) {
      authCount += 1;
    }
  }

  let accessCount = 0;
  if (formData.visibility && formData.visibility !== 'private') {
    accessCount += 1;
  }
  const slotCount = formData.credentialTemplate?.length ?? 0;
  if (slotCount > 0) {
    accessCount += slotCount;
  }

  let runtimeCount = 0;
  if (serverType !== 'openapi') {
    const opts = formData.options;
    if (
      (opts?.timeout !== undefined && opts.timeout !== 60000) ||
      opts?.maxTotalTimeout !== undefined ||
      opts?.maxBufferSize !== undefined ||
      opts?.resetTimeoutOnProgress === false
    ) {
      runtimeCount += 1;
    }
    if (
      (serverType === 'sse' || serverType === 'streamable-http') &&
      formData.keepAlive?.enabled
    ) {
      runtimeCount += 1;
    }
    if (formData.perSessionClient) {
      runtimeCount += 1;
    }
    if (serverType === 'stdio' && formData.startOnDemand) {
      runtimeCount += 1;
    }
  }

  return {
    connection: 0,
    auth: authCount,
    access: accessCount,
    runtime: runtimeCount,
  };
};

export const validateServerForm = ({
  formData,
  serverType,
  initialServerName,
  relayOrigins = '',
  relayMetadata = '',
}: {
  formData: ServerFormData;
  serverType: ServerType;
  initialServerName?: string | null;
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
  if (serverType !== 'openapi') {
    const timeout = formData.options?.timeout;
    if (timeout !== undefined && (Number.isNaN(timeout) || timeout < 1000 || timeout > 300000)) {
      return {
        tab: 'runtime',
        messageKey: 'server.validationTimeoutRange',
        focusId: 'timeout',
      };
    }

    const maxTotalTimeout = formData.options?.maxTotalTimeout;
    if (maxTotalTimeout !== undefined && (Number.isNaN(maxTotalTimeout) || maxTotalTimeout < 1000)) {
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
      if (interval !== undefined && (Number.isNaN(interval) || interval < 5000 || interval > 300000)) {
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
      if (idleTimeoutMs !== undefined && (Number.isNaN(idleTimeoutMs) || idleTimeoutMs < 10000)) {
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
