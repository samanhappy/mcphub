import React from 'react';
import { useTranslation } from 'react-i18next';
import { Sparkles } from 'lucide-react';
import type { ServerFormData } from '@/types';
import type { OpenApiSecurityNotice } from '../../utils/openApiSecurityPrefill';
import type { ServerType } from '../../utils/serverFormUi';
import {
  FieldLabel,
  FORM_CONTROL_CLASS,
  FORM_TEXTAREA_CLASS,
  PasswordInput,
  SectionCard,
} from './FormPrimitives';

interface AuthSectionProps {
  formData: ServerFormData;
  setFormData: React.Dispatch<React.SetStateAction<ServerFormData>>;
  serverType: ServerType;
  isAdmin: boolean;
  openApiSourcePresent: boolean;
  openApiStatsLoading: boolean;
  securityDetectionLoading: boolean;
  openApiSecurityNotice: OpenApiSecurityNotice | null;
  onDetectOpenApiSecurity: () => void;
  onMarkOpenApiSecurityTouched: () => void;
  onOAuthChange: <K extends keyof NonNullable<ServerFormData['oauth']>>(
    field: K,
    value: NonNullable<ServerFormData['oauth']>[K],
  ) => void;
  relayOrigins: string;
  setRelayOrigins: React.Dispatch<React.SetStateAction<string>>;
  relayMetadata: string;
  setRelayMetadata: React.Dispatch<React.SetStateAction<string>>;
  onFieldMutated: () => void;
}

export const AuthSection: React.FC<AuthSectionProps> = ({
  formData,
  setFormData,
  serverType,
  isAdmin,
  openApiSourcePresent,
  openApiStatsLoading,
  securityDetectionLoading,
  openApiSecurityNotice,
  onDetectOpenApiSecurity,
  onMarkOpenApiSecurityTouched,
  onOAuthChange,
  relayOrigins,
  setRelayOrigins,
  relayMetadata,
  setRelayMetadata,
  onFieldMutated,
}) => {
  const { t } = useTranslation();
  const openApiPersonalOAuth = formData.oauth?.identityMode === 'personal';
  const specHttpScheme = formData.openapi?.specHttpScheme || 'basic';

  if (serverType === 'openapi') {
    return (
      <div className="space-y-4">
        <SectionCard
          title={t('server.openapi.security')}
          action={
            <button
              type="button"
              onClick={onDetectOpenApiSecurity}
              disabled={
                openApiPersonalOAuth ||
                securityDetectionLoading ||
                openApiStatsLoading ||
                !openApiSourcePresent
              }
              className="hub-btn sm"
            >
              <Sparkles size={12} />
              {securityDetectionLoading || openApiStatsLoading
                ? t('server.openapi.securityDetecting')
                : t('server.openapi.securityDetect')}
            </button>
          }
        >
          <div onChange={onMarkOpenApiSecurityTouched} className="space-y-3">
            <div>
              <select
                id="openApiSecurityType"
                aria-label={t('server.openapi.security')}
                value={
                  openApiPersonalOAuth
                    ? 'personalOAuth'
                    : formData.openapi?.securityType || 'none'
                }
                onChange={(e) => {
                  onFieldMutated();
                  const value = e.target.value;
                  const personal = value === 'personalOAuth';
                  setFormData((prev) => ({
                    ...prev,
                    oauth: { ...prev.oauth, identityMode: personal ? 'personal' : 'shared' },
                    openapi: {
                      ...prev.openapi,
                      securityType: personal
                        ? 'none'
                        : (value as NonNullable<ServerFormData['openapi']>['securityType']),
                      url: prev.openapi?.url || '',
                    },
                  }));
                }}
                className={FORM_CONTROL_CLASS}
              >
                <option value="none">{t('server.openapi.securityNone')}</option>
                <option value="apiKey">{t('server.openapi.securityApiKey')}</option>
                <option value="http">{t('server.openapi.securityHttp')}</option>
                <option value="oauth2">{t('server.openapi.securityOAuth2')}</option>
                <option value="personalOAuth">{t('server.openapi.securityPersonalOAuth')}</option>
                <option value="openIdConnect">{t('server.openapi.securityOpenIdConnect')}</option>
              </select>
              {openApiSecurityNotice && (
                <p
                  className={`mt-2 text-xs ${
                    openApiSecurityNotice.kind === 'warning'
                      ? 'text-amber-700 dark:text-amber-300'
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

            {!openApiPersonalOAuth && formData.openapi?.securityType === 'apiKey' && (
              <div
                className="rounded-lg p-3.5 space-y-3"
                style={{
                  border: '1px solid var(--hub-line)',
                  background: 'var(--hub-bg-2)',
                }}
              >
                <h4 className="text-xs font-semibold text-[var(--hub-ink)]">
                  {t('server.openapi.apiKeyConfig')}
                </h4>
                <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                  <div>
                    <FieldLabel htmlFor="openapi-apiKeyName">
                      {t('server.openapi.apiKeyName')}
                    </FieldLabel>
                    <input
                      id="openapi-apiKeyName"
                      type="text"
                      value={formData.openapi?.apiKeyName || ''}
                      onChange={(e) => {
                        onFieldMutated();
                        setFormData((prev) => ({
                          ...prev,
                          openapi: {
                            ...prev.openapi,
                            apiKeyName: e.target.value,
                            url: prev.openapi?.url || '',
                          },
                        }));
                      }}
                      className={FORM_CONTROL_CLASS}
                      placeholder="Authorization"
                    />
                  </div>
                  <div>
                    <FieldLabel htmlFor="openapi-apiKeyIn">
                      {t('server.openapi.apiKeyIn')}
                    </FieldLabel>
                    <select
                      id="openapi-apiKeyIn"
                      value={formData.openapi?.apiKeyIn || 'header'}
                      onChange={(e) => {
                        onFieldMutated();
                        setFormData((prev) => ({
                          ...prev,
                          openapi: {
                            ...prev.openapi,
                            apiKeyIn: e.target.value as 'header' | 'query' | 'cookie',
                            url: prev.openapi?.url || '',
                          },
                        }));
                      }}
                      className={FORM_CONTROL_CLASS}
                    >
                      <option value="header">{t('server.openapi.apiKeyInHeader')}</option>
                      <option value="query">{t('server.openapi.apiKeyInQuery')}</option>
                      <option value="cookie">{t('server.openapi.apiKeyInCookie')}</option>
                    </select>
                  </div>
                  <div>
                    <FieldLabel htmlFor="openapi-apiKeyValue">
                      {t('server.openapi.apiKeyValue')}
                    </FieldLabel>
                    <PasswordInput
                      id="openapi-apiKeyValue"
                      value={formData.openapi?.apiKeyValue || ''}
                      onChange={(e) => {
                        onFieldMutated();
                        setFormData((prev) => ({
                          ...prev,
                          openapi: {
                            ...prev.openapi,
                            apiKeyValue: e.target.value,
                            url: prev.openapi?.url || '',
                          },
                        }));
                      }}
                      placeholder="your-api-key"
                    />
                  </div>
                </div>
              </div>
            )}

            {!openApiPersonalOAuth && formData.openapi?.securityType === 'http' && (
              <div
                className="rounded-lg p-3.5 space-y-3"
                style={{
                  border: '1px solid var(--hub-line)',
                  background: 'var(--hub-bg-2)',
                }}
              >
                <h4 className="text-xs font-semibold text-[var(--hub-ink)]">
                  {t('server.openapi.httpAuthConfig')}
                </h4>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                  <div>
                    <FieldLabel htmlFor="openapi-httpScheme">
                      {t('server.openapi.httpScheme')}
                    </FieldLabel>
                    <select
                      id="openapi-httpScheme"
                      value={formData.openapi?.httpScheme || 'bearer'}
                      onChange={(e) => {
                        onFieldMutated();
                        setFormData((prev) => ({
                          ...prev,
                          openapi: {
                            ...prev.openapi,
                            httpScheme: e.target.value as 'basic' | 'bearer' | 'digest',
                            url: prev.openapi?.url || '',
                          },
                        }));
                      }}
                      className={FORM_CONTROL_CLASS}
                    >
                      <option value="basic">{t('server.openapi.httpSchemeBasic')}</option>
                      <option value="bearer">{t('server.openapi.httpSchemeBearer')}</option>
                      <option value="digest">{t('server.openapi.httpSchemeDigest')}</option>
                    </select>
                  </div>
                  <div>
                    <FieldLabel htmlFor="openapi-httpCredentials">
                      {t('server.openapi.httpCredentials')}
                    </FieldLabel>
                    <PasswordInput
                      id="openapi-httpCredentials"
                      value={formData.openapi?.httpCredentials || ''}
                      onChange={(e) => {
                        onFieldMutated();
                        setFormData((prev) => ({
                          ...prev,
                          openapi: {
                            ...prev.openapi,
                            httpCredentials: e.target.value,
                            url: prev.openapi?.url || '',
                          },
                        }));
                      }}
                      placeholder={
                        formData.openapi?.httpScheme === 'basic'
                          ? 'user:password'
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

            {!openApiPersonalOAuth && formData.openapi?.securityType === 'openIdConnect' && (
              <div
                className="rounded-lg p-3.5 space-y-3"
                style={{
                  border: '1px solid var(--hub-line)',
                  background: 'var(--hub-bg-2)',
                }}
              >
                <h4 className="text-xs font-semibold text-[var(--hub-ink)]">
                  {t('server.openapi.openIdConnectConfig')}
                </h4>
                <div className="grid grid-cols-1 gap-3">
                  <div>
                    <FieldLabel htmlFor="openapi-openIdConnectUrl">
                      {t('server.openapi.openIdConnectUrl')}
                    </FieldLabel>
                    <input
                      id="openapi-openIdConnectUrl"
                      type="url"
                      value={formData.openapi?.openIdConnectUrl || ''}
                      onChange={(e) => {
                        onFieldMutated();
                        setFormData((prev) => ({
                          ...prev,
                          openapi: {
                            ...prev.openapi,
                            openIdConnectUrl: e.target.value,
                            url: prev.openapi?.url || '',
                          },
                        }));
                      }}
                      className={`${FORM_CONTROL_CLASS} hub-mono`}
                      placeholder="https://example.com/.well-known/openid_configuration"
                    />
                  </div>
                  <div>
                    <FieldLabel htmlFor="openapi-openIdConnectToken">
                      {t('server.openapi.openIdConnectToken')}
                    </FieldLabel>
                    <PasswordInput
                      id="openapi-openIdConnectToken"
                      value={formData.openapi?.openIdConnectToken || ''}
                      onChange={(e) => {
                        onFieldMutated();
                        setFormData((prev) => ({
                          ...prev,
                          openapi: {
                            ...prev.openapi,
                            openIdConnectToken: e.target.value,
                            url: prev.openapi?.url || '',
                          },
                        }));
                      }}
                      placeholder="id-token"
                    />
                  </div>
                </div>
              </div>
            )}

            {openApiPersonalOAuth && (
              <div
                className="rounded-lg p-3.5 space-y-3"
                style={{
                  border: '1px solid var(--hub-line)',
                  background: 'var(--hub-bg-2)',
                }}
              >
                <p className="text-xs text-[var(--hub-ink-3)]">
                  {t('server.oauth.personalIdentityHelp')}
                </p>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                  {(
                    [
                      { field: 'clientId', type: 'text', required: true },
                      { field: 'clientSecret', type: 'password' },
                      {
                        field: 'authorizationEndpoint',
                        type: 'url',
                        required: true,
                        metadataField: 'authorization_endpoint',
                      },
                      {
                        field: 'tokenEndpoint',
                        type: 'url',
                        required: true,
                        metadataField: 'token_endpoint',
                      },
                      { field: 'scopes', type: 'text' },
                    ] as const
                  ).map(({ field, type, ...options }) => {
                    const metadata = formData.oauth?.authorizationServerMetadata;
                    const metadataField =
                      'metadataField' in options ? options.metadataField : undefined;
                    const inputId = `openapi-personal-oauth-${field}`;
                    const value =
                      (metadataField && metadata?.[metadataField]) ?? formData.oauth?.[field] ?? '';
                    const handleChange = (nextVal: string) => {
                      onFieldMutated();
                      if (metadataField && metadata) {
                        onOAuthChange('authorizationServerMetadata', {
                          ...metadata,
                          [metadataField]: nextVal,
                        });
                      } else {
                        onOAuthChange(field, nextVal);
                      }
                    };

                    return (
                      <div key={field}>
                        <FieldLabel htmlFor={inputId} required={'required' in options}>
                          {t(`server.oauth.${field}`)}
                        </FieldLabel>
                        {type === 'password' ? (
                          <PasswordInput
                            id={inputId}
                            value={value}
                            autoComplete="new-password"
                            onChange={(e) => handleChange(e.target.value)}
                          />
                        ) : (
                          <input
                            id={inputId}
                            type={type}
                            value={value}
                            required={'required' in options}
                            aria-required={'required' in options ? 'true' : undefined}
                            placeholder={
                              field === 'scopes' ? t('server.oauth.scopesPlaceholder') : undefined
                            }
                            onChange={(e) => handleChange(e.target.value)}
                            className={FORM_CONTROL_CLASS}
                          />
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>
            )}

            {!openApiPersonalOAuth && formData.openapi?.securityType === 'oauth2' && (
              <div
                className="rounded-lg p-3.5 space-y-3"
                style={{
                  border: '1px solid var(--hub-line)',
                  background: 'var(--hub-bg-2)',
                }}
              >
                <h4 className="text-xs font-semibold text-[var(--hub-ink)]">
                  {t('server.openapi.oauth2Config')}
                </h4>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                  <div className="md:col-span-2">
                    <FieldLabel htmlFor="openapi-oauth2TokenUrl">
                      {t('server.oauth.tokenEndpoint')}
                    </FieldLabel>
                    <input
                      id="openapi-oauth2TokenUrl"
                      type="url"
                      value={formData.openapi?.oauth2TokenUrl || ''}
                      onChange={(e) => {
                        onFieldMutated();
                        setFormData((prev) => ({
                          ...prev,
                          openapi: {
                            ...prev.openapi,
                            oauth2TokenUrl: e.target.value,
                            url: prev.openapi?.url || '',
                          },
                        }));
                      }}
                      className={`${FORM_CONTROL_CLASS} hub-mono`}
                      placeholder="https://example.com/oauth/token"
                    />
                  </div>
                  <div>
                    <FieldLabel htmlFor="openapi-oauth2ClientId">
                      {t('server.oauth.clientId')}
                    </FieldLabel>
                    <input
                      id="openapi-oauth2ClientId"
                      type="text"
                      value={formData.openapi?.oauth2ClientId || ''}
                      onChange={(e) => {
                        onFieldMutated();
                        setFormData((prev) => ({
                          ...prev,
                          openapi: {
                            ...prev.openapi,
                            oauth2ClientId: e.target.value,
                            url: prev.openapi?.url || '',
                          },
                        }));
                      }}
                      className={FORM_CONTROL_CLASS}
                    />
                  </div>
                  <div>
                    <FieldLabel htmlFor="openapi-oauth2ClientSecret">
                      {t('server.oauth.clientSecret')}
                    </FieldLabel>
                    <PasswordInput
                      id="openapi-oauth2ClientSecret"
                      value={formData.openapi?.oauth2ClientSecret || ''}
                      onChange={(e) => {
                        onFieldMutated();
                        setFormData((prev) => ({
                          ...prev,
                          openapi: {
                            ...prev.openapi,
                            oauth2ClientSecret: e.target.value,
                            url: prev.openapi?.url || '',
                          },
                        }));
                      }}
                    />
                  </div>
                  <div className="md:col-span-2">
                    <FieldLabel htmlFor="openapi-oauth2Token">
                      {t('server.openapi.oauth2Token')}
                    </FieldLabel>
                    <PasswordInput
                      id="openapi-oauth2Token"
                      value={formData.openapi?.oauth2Token || ''}
                      onChange={(e) => {
                        onFieldMutated();
                        setFormData((prev) => ({
                          ...prev,
                          openapi: {
                            ...prev.openapi,
                            oauth2Token: e.target.value,
                            url: prev.openapi?.url || '',
                          },
                        }));
                      }}
                      placeholder="access-token"
                    />
                  </div>
                </div>
              </div>
            )}
          </div>
        </SectionCard>

        <SectionCard title={t('server.openapi.specSecurityToggle')}>
          <div className="space-y-3">
            <label
              htmlFor="openapiSpecSecurity"
              className="flex items-start gap-2.5 cursor-pointer"
            >
              <input
                type="checkbox"
                id="openapiSpecSecurity"
                checked={(formData.openapi?.specSecurityType || 'none') !== 'none'}
                onChange={(e) => {
                  onFieldMutated();
                  setFormData((prev) => ({
                    ...prev,
                    openapi: {
                      ...prev.openapi,
                      url: prev.openapi?.url || '',
                      specSecurityType: e.target.checked ? 'http' : 'none',
                      specHttpScheme: prev.openapi?.specHttpScheme || 'basic',
                    },
                  }));
                }}
                className="mt-0.5"
              />
              <div>
                <span className="text-[13px] font-medium text-[var(--hub-ink)] block">
                  {t('server.openapi.specSecurityToggle')}
                </span>
                <span className="text-xs text-[var(--hub-ink-3)] block mt-0.5">
                  {t('server.openapi.specSecurityHelp')}
                </span>
              </div>
            </label>

            {(formData.openapi?.specSecurityType || 'none') !== 'none' && (
              <div
                className="rounded-lg p-3.5 space-y-3"
                style={{
                  border: '1px solid var(--hub-line)',
                  background: 'var(--hub-bg-2)',
                }}
              >
                <div>
                  <FieldLabel htmlFor="openapi-specSecurityType">
                    {t('server.openapi.security')}
                  </FieldLabel>
                  <select
                    id="openapi-specSecurityType"
                    value={formData.openapi?.specSecurityType || 'http'}
                    onChange={(e) => {
                      onFieldMutated();
                      setFormData((prev) => ({
                        ...prev,
                        openapi: {
                          ...prev.openapi,
                          url: prev.openapi?.url || '',
                          specSecurityType: e.target.value as 'http' | 'apiKey' | 'oauth2',
                        },
                      }));
                    }}
                    className={FORM_CONTROL_CLASS}
                  >
                    <option value="http">{t('server.openapi.securityHttp')}</option>
                    <option value="apiKey">{t('server.openapi.securityApiKey')}</option>
                    <option value="oauth2">{t('server.openapi.securityOAuth2')}</option>
                  </select>
                </div>

                {formData.openapi?.specSecurityType === 'http' && (
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                    <div>
                      <FieldLabel htmlFor="openapi-specHttpScheme">
                        {t('server.openapi.httpScheme')}
                      </FieldLabel>
                      <select
                        id="openapi-specHttpScheme"
                        value={specHttpScheme}
                        onChange={(e) => {
                          onFieldMutated();
                          setFormData((prev) => ({
                            ...prev,
                            openapi: {
                              ...prev.openapi,
                              url: prev.openapi?.url || '',
                              specHttpScheme: e.target.value as 'basic' | 'bearer',
                            },
                          }));
                        }}
                        className={FORM_CONTROL_CLASS}
                      >
                        <option value="basic">{t('server.openapi.httpSchemeBasic')}</option>
                        <option value="bearer">{t('server.openapi.httpSchemeBearer')}</option>
                      </select>
                    </div>
                    <div>
                      <FieldLabel htmlFor="openapi-specHttpCredentials">
                        {t('server.openapi.httpCredentials')}
                      </FieldLabel>
                      <PasswordInput
                        id="openapi-specHttpCredentials"
                        value={formData.openapi?.specHttpCredentials || ''}
                        onChange={(e) => {
                          onFieldMutated();
                          setFormData((prev) => ({
                            ...prev,
                            openapi: {
                              ...prev.openapi,
                              url: prev.openapi?.url || '',
                              specHttpCredentials: e.target.value,
                            },
                          }));
                        }}
                        placeholder={
                          specHttpScheme === 'basic' ? 'user:password' : 'bearer-token'
                        }
                      />
                    </div>
                  </div>
                )}

                {formData.openapi?.specSecurityType === 'apiKey' && (
                  <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                    <div>
                      <FieldLabel htmlFor="openapi-specApiKeyName">
                        {t('server.openapi.apiKeyName')}
                      </FieldLabel>
                      <input
                        id="openapi-specApiKeyName"
                        type="text"
                        value={formData.openapi?.specApiKeyName || ''}
                        onChange={(e) => {
                          onFieldMutated();
                          setFormData((prev) => ({
                            ...prev,
                            openapi: {
                              ...prev.openapi,
                              url: prev.openapi?.url || '',
                              specApiKeyName: e.target.value,
                            },
                          }));
                        }}
                        className={FORM_CONTROL_CLASS}
                        placeholder="X-API-Key"
                      />
                    </div>
                    <div>
                      <FieldLabel htmlFor="openapi-specApiKeyIn">
                        {t('server.openapi.apiKeyIn')}
                      </FieldLabel>
                      <select
                        id="openapi-specApiKeyIn"
                        value={formData.openapi?.specApiKeyIn || 'header'}
                        onChange={(e) => {
                          onFieldMutated();
                          setFormData((prev) => ({
                            ...prev,
                            openapi: {
                              ...prev.openapi,
                              url: prev.openapi?.url || '',
                              specApiKeyIn: e.target.value as 'header' | 'query' | 'cookie',
                            },
                          }));
                        }}
                        className={FORM_CONTROL_CLASS}
                      >
                        <option value="header">{t('server.openapi.apiKeyInHeader')}</option>
                        <option value="query">{t('server.openapi.apiKeyInQuery')}</option>
                        <option value="cookie">{t('server.openapi.apiKeyInCookie')}</option>
                      </select>
                    </div>
                    <div>
                      <FieldLabel htmlFor="openapi-specApiKeyValue">
                        {t('server.openapi.apiKeyValue')}
                      </FieldLabel>
                      <PasswordInput
                        id="openapi-specApiKeyValue"
                        value={formData.openapi?.specApiKeyValue || ''}
                        onChange={(e) => {
                          onFieldMutated();
                          setFormData((prev) => ({
                            ...prev,
                            openapi: {
                              ...prev.openapi,
                              url: prev.openapi?.url || '',
                              specApiKeyValue: e.target.value,
                            },
                          }));
                        }}
                      />
                    </div>
                  </div>
                )}

                {formData.openapi?.specSecurityType === 'oauth2' && (
                  <div>
                    <FieldLabel htmlFor="openapi-specOauth2Token">
                      {t('server.openapi.oauth2Token')}
                    </FieldLabel>
                    <PasswordInput
                      id="openapi-specOauth2Token"
                      value={formData.openapi?.specOauth2Token || ''}
                      onChange={(e) => {
                        onFieldMutated();
                        setFormData((prev) => ({
                          ...prev,
                          openapi: {
                            ...prev.openapi,
                            url: prev.openapi?.url || '',
                            specOauth2Token: e.target.value,
                          },
                        }));
                      }}
                      placeholder="access-token"
                    />
                  </div>
                )}
              </div>
            )}
          </div>
        </SectionCard>

        <SectionCard title={t('server.openapi.passthroughHeaders')}>
          <div className="space-y-4">
            <div>
              <input
                id="openapi-passthroughHeaders"
                aria-label={t('server.openapi.passthroughHeaders')}
                type="text"
                value={formData.openapi?.passthroughHeaders || ''}
                onChange={(e) => {
                  onFieldMutated();
                  setFormData((prev) => ({
                    ...prev,
                    openapi: {
                      ...prev.openapi,
                      passthroughHeaders: e.target.value,
                      url: prev.openapi?.url || '',
                    },
                  }));
                }}
                className={`${FORM_CONTROL_CLASS} hub-mono`}
                placeholder="Authorization, X-API-Key, X-Custom-Header"
              />
              <p className="text-xs text-[var(--hub-ink-3)] mt-1">
                {t('server.openapi.passthroughHeadersHelp')}
              </p>
            </div>

            <div className="pt-3 border-t border-[var(--hub-line-2)]">
              <label
                htmlFor="openapiCookieSession"
                className="flex items-start gap-2.5 cursor-pointer"
              >
                <input
                  type="checkbox"
                  id="openapiCookieSession"
                  checked={formData.openapi?.cookieSession || false}
                  onChange={(e) => {
                    onFieldMutated();
                    setFormData((prev) => ({
                      ...prev,
                      openapi: {
                        ...prev.openapi,
                        passthroughHeaders: prev.openapi?.passthroughHeaders || '',
                        url: prev.openapi?.url || '',
                        cookieSession: e.target.checked,
                      },
                    }));
                  }}
                  className="mt-0.5"
                />
                <div>
                  <span className="text-[13px] font-medium text-[var(--hub-ink)] block">
                    {t('server.openapi.cookieSession', 'Cookie Session Handling')}
                  </span>
                  <span className="text-xs text-[var(--hub-ink-3)] block mt-0.5">
                    {t(
                      'server.openapi.cookieSessionHelp',
                      'Capture Set-Cookie from upstream login responses and replay them on later calls within the same downstream session. Isolated per MCP session; not persisted.',
                    )}
                  </span>
                </div>
              </label>
            </div>
          </div>
        </SectionCard>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <SectionCard
        title={t('server.oauth.sectionTitle')}
        description={t('server.oauth.sectionDescription')}
      >
        {(serverType === 'sse' || serverType === 'streamable-http') && (
          <div>
            <FieldLabel htmlFor="oauthIdentityMode">{t('server.oauth.identityMode')}</FieldLabel>
            <select
              id="oauthIdentityMode"
              className={FORM_CONTROL_CLASS}
              value={formData.oauth?.identityMode || 'shared'}
              onChange={(e) => {
                onFieldMutated();
                onOAuthChange('identityMode', e.target.value as 'shared' | 'personal');
                if (e.target.value !== 'personal') {
                  onOAuthChange('authorizationRelay', undefined);
                }
              }}
            >
              <option value="shared">{t('server.oauth.sharedIdentity')}</option>
              <option value="personal">{t('server.oauth.personalIdentity')}</option>
            </select>
            <p className="text-xs text-[var(--hub-ink-3)] mt-1">
              {t('server.oauth.personalIdentityHelp')}
            </p>
          </div>
        )}

        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          <div>
            <FieldLabel htmlFor="oauth-clientId">{t('server.oauth.clientId')}</FieldLabel>
            <input
              id="oauth-clientId"
              type="text"
              value={formData.oauth?.clientId || ''}
              onChange={(e) => {
                onFieldMutated();
                onOAuthChange('clientId', e.target.value);
              }}
              className={FORM_CONTROL_CLASS}
              autoComplete="off"
            />
          </div>
          <div>
            <FieldLabel htmlFor="oauth-clientSecret">{t('server.oauth.clientSecret')}</FieldLabel>
            <PasswordInput
              id="oauth-clientSecret"
              value={formData.oauth?.clientSecret || ''}
              onChange={(e) => {
                onFieldMutated();
                onOAuthChange('clientSecret', e.target.value);
              }}
              autoComplete="off"
            />
          </div>
        </div>

        {(serverType === 'sse' || serverType === 'streamable-http') &&
          (isAdmin || formData.oauth?.allowInsecureTokenEndpoint) && (
            <div className="pt-3 border-t border-[var(--hub-line-2)]">
              <label
                htmlFor="oauth-allowInsecureTokenEndpoint"
                className="flex items-start gap-2.5 cursor-pointer"
              >
                <input
                  id="oauth-allowInsecureTokenEndpoint"
                  type="checkbox"
                  checked={formData.oauth?.allowInsecureTokenEndpoint === true}
                  disabled={!isAdmin}
                  onChange={(e) => {
                    onFieldMutated();
                    onOAuthChange('allowInsecureTokenEndpoint', e.target.checked);
                  }}
                  className="mt-0.5"
                />
                <div>
                  <span className="text-[13px] font-medium text-[var(--hub-ink)] block">
                    {t('server.oauth.allowInsecureTokenEndpoint')}
                  </span>
                  <span className="text-xs text-amber-700 dark:text-amber-400 block mt-0.5">
                    {t('server.oauth.allowInsecureTokenEndpointHelp')}
                  </span>
                </div>
              </label>
            </div>
          )}

        {(serverType === 'sse' || serverType === 'streamable-http') &&
          formData.oauth?.identityMode === 'personal' &&
          (isAdmin || formData.oauth.authorizationRelay) && (
            <div
              className="rounded-lg p-3.5 space-y-3"
              style={{
                border: '1px solid var(--hub-line)',
                background: 'var(--hub-bg-2)',
              }}
            >
              <label
                htmlFor="oauthAuthorizationRelay"
                className="flex items-start gap-2.5 cursor-pointer"
              >
                <input
                  type="checkbox"
                  id="oauthAuthorizationRelay"
                  checked={Boolean(formData.oauth.authorizationRelay)}
                  disabled={!isAdmin}
                  onChange={(e) => {
                    onFieldMutated();
                    onOAuthChange(
                      'authorizationRelay',
                      e.target.checked ? { allowedRedirectOrigins: [] } : undefined,
                    );
                  }}
                  className="mt-0.5"
                />
                <div>
                  <span className="text-[13px] font-medium text-[var(--hub-ink)] block">
                    {t('server.oauth.relayEnabled')}
                  </span>
                  <span className="text-xs text-[var(--hub-ink-3)] block mt-0.5">
                    {t('server.oauth.relayHelp')}
                  </span>
                </div>
              </label>

              {formData.oauth.authorizationRelay && (
                <div className="space-y-3 pt-2 border-t border-[var(--hub-line-2)]">
                  <div>
                    <FieldLabel htmlFor="oauthRelayOrigins" required>
                      {t('server.oauth.relayOrigins')}
                    </FieldLabel>
                    <textarea
                      id="oauthRelayOrigins"
                      rows={2}
                      required
                      disabled={!isAdmin}
                      value={relayOrigins}
                      onChange={(e) => {
                        onFieldMutated();
                        setRelayOrigins(e.target.value);
                      }}
                      placeholder="https://login.microsoftonline.com"
                      className={`${FORM_TEXTAREA_CLASS} hub-mono text-xs`}
                    />
                    <p className="text-xs text-[var(--hub-ink-3)] mt-1">
                      {t('server.oauth.relayOriginsHelp')}
                    </p>
                  </div>
                  <div>
                    <FieldLabel htmlFor="oauthRelayMetadata" required>
                      {t('server.oauth.relayMetadata')}
                    </FieldLabel>
                    <textarea
                      id="oauthRelayMetadata"
                      rows={7}
                      wrap="off"
                      required
                      disabled={!isAdmin}
                      value={relayMetadata}
                      onChange={(e) => {
                        onFieldMutated();
                        setRelayMetadata(e.target.value);
                      }}
                      placeholder={
                        '{\n  "issuer": "http://broker.internal:3000",\n  "authorization_endpoint": "http://broker.internal:3000/authorize",\n  "token_endpoint": "http://broker.internal:3000/token",\n  "response_types_supported": ["code"]\n}'
                      }
                      className={`${FORM_TEXTAREA_CLASS} hub-mono text-xs`}
                    />
                    <p className="text-xs text-[var(--hub-ink-3)] mt-1">
                      {t('server.oauth.relayMetadataHelp')}
                    </p>
                  </div>
                </div>
              )}
            </div>
          )}
      </SectionCard>

      {(serverType === 'sse' || serverType === 'streamable-http') && (
        <SectionCard title={t('server.openapi.passthroughHeaders')}>
          <div>
            <input
              id="server-passthroughHeaders"
              aria-label={t('server.openapi.passthroughHeaders')}
              type="text"
              value={formData.passthroughHeaders || ''}
              onChange={(e) => {
                onFieldMutated();
                setFormData((prev) => ({
                  ...prev,
                  passthroughHeaders: e.target.value,
                }));
              }}
              className={`${FORM_CONTROL_CLASS} hub-mono`}
              placeholder="Authorization, X-Custom-User-Id"
            />
            <p className="text-xs text-[var(--hub-ink-3)] mt-1">
              {t('server.openapi.passthroughHeadersHelp')}
            </p>
          </div>
        </SectionCard>
      )}
    </div>
  );
};
