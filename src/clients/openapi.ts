import axios, { AxiosInstance, AxiosRequestConfig, AxiosResponse } from 'axios';
import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { CookieJar } from 'tough-cookie';
import SwaggerParser from '@apidevtools/swagger-parser';
import * as yaml from 'js-yaml';
import { OpenAPIV3 } from 'openapi-types';
import { ServerConfig, OpenAPISecurityConfig } from '../types/index.js';
import { assertSafeUrl, UnsafeUrlError, createRedirectValidatingFetch } from '../utils/ssrf.js';
import { getUserDao } from '../dao/index.js';
import { sanitizeStringForLogging, createSafeJSON } from '../utils/serialization.js';
import {
  buildMultipartParts,
  encodeFormUrlEncoded,
  makeMultipartBodySchemaModelFriendly,
  selectRequestBodyContent,
  serializeMultipartBody,
  type RequestBodyContentSelection,
} from '../utils/openApiRequestBody.js';

export interface OpenAPIToolInfo {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
  operationId: string;
  method: string;
  path: string;
  parameters?: OpenAPIV3.ParameterObject[];
  requestBody?: OpenAPIV3.RequestBodyObject;
  responses?: OpenAPIV3.ResponsesObject;
}

type OpenAPIOAuth2Config = NonNullable<OpenAPISecurityConfig['oauth2']>;

interface OpenAPIClientOptions {
  persistOAuth2Token?: (oauth2: OpenAPISecurityConfig['oauth2']) => Promise<void> | void;
}

// Encodes a substituted path parameter following OpenAPI's default
// `style: simple, explode: false`: primitives whole, arrays and objects part
// by part, joined with literal commas (#1083).
function encodePathParameterValue(value: unknown): string {
  if (Array.isArray(value)) {
    return value.map((item) => encodeURIComponent(String(item))).join(',');
  }
  if (value !== null && typeof value === 'object') {
    return Object.entries(value as Record<string, unknown>)
      .map(([key, val]) => `${encodeURIComponent(key)},${encodeURIComponent(String(val))}`)
      .join(',');
  }
  return encodeURIComponent(String(value));
}

export class OpenAPIClient {
  private httpClient: AxiosInstance;
  private spec: OpenAPIV3.Document | null = null;
  private tools: OpenAPIToolInfo[] = [];
  private baseUrl: string;
  private securityConfig?: OpenAPISecurityConfig;
  private readonly persistOAuth2Token?: OpenAPIClientOptions['persistOAuth2Token'];
  private oauth2TokenRequest?: Promise<string | undefined>;
  // Per-session cookie jars for the dynamic Set-Cookie login flow. Keyed by
  // downstream MCP sessionId so authenticated state never crosses users or
  // sessions. In-memory only; never persisted.
  private readonly cookieJars = new Map<string, CookieJar>();
  private static readonly MAX_COOKIE_JARS = 1000;
  // Static cookie from `apiKey.in: 'cookie'` config, merged into the Cookie
  // header at call time. Seeded into each session jar so a dynamic Set-Cookie
  // of the same name can override it.
  private staticCookieHeader?: string;
  // Resolved in initialize(): admin-owned servers may target internal services
  // and skip the SSRF internal-IP blocklist.
  private allowInternalNetworks = false;
  // Records the most recent SSRF rejection raised while resolving external
  // $refs. SwaggerParser wraps resolver failures in its own ResolverError and
  // drops the original cause, so initialize() uses this to re-throw the real
  // UnsafeUrlError to callers.
  private refGuardRejection?: UnsafeUrlError;

  constructor(
    private config: ServerConfig,
    options: OpenAPIClientOptions = {},
  ) {
    if (!config.openapi?.url && !config.openapi?.schema) {
      throw new Error('OpenAPI URL or schema is required');
    }

    // Initial baseUrl, will be updated from OpenAPI servers field in initialize()
    this.baseUrl = config.openapi?.url ? this.extractBaseUrl(config.openapi.url) : '';
    this.securityConfig = config.openapi.security;
    this.persistOAuth2Token = options.persistOAuth2Token;

    this.httpClient = axios.create({
      baseURL: this.baseUrl,
      timeout: config.options?.timeout || 30000,
      maxRedirects: 0,
      // Serialize array query params per OpenAPI's default `style: form, explode: true`
      // (`id=a&id=b`) instead of axios's bracket form `id[]=a&id[]=b` (#1080).
      paramsSerializer: { indexes: null },
      headers: {
        'Content-Type': 'application/json',
        ...config.headers,
      },
    });

    this.setupSecurity();
  }

  private extractBaseUrl(specUrl: string): string {
    try {
      const url = new URL(specUrl);
      return `${url.protocol}//${url.host}`;
    } catch {
      // If specUrl is a relative path, assume current host
      return '';
    }
  }

  private setupSecurity(): void {
    if (!this.securityConfig || this.securityConfig.type === 'none') {
      return;
    }

    switch (this.securityConfig.type) {
      case 'apiKey':
        if (this.securityConfig.apiKey) {
          const { name, in: location, value } = this.securityConfig.apiKey;
          if (location === 'header') {
            this.httpClient.defaults.headers.common[name] = value;
          } else if (location === 'query') {
            this.httpClient.interceptors.request.use((config: any) => {
              config.params = { ...config.params, [name]: value };
              return config;
            });
          } else if (location === 'cookie') {
            this.staticCookieHeader = `${name}=${value}`;
          }
        }
        break;

      case 'http':
        if (this.securityConfig.http) {
          const { scheme, credentials } = this.securityConfig.http;
          if (scheme === 'bearer' && credentials) {
            this.httpClient.defaults.headers.common['Authorization'] = `Bearer ${credentials}`;
          } else if (scheme === 'basic' && credentials) {
            this.httpClient.defaults.headers.common['Authorization'] = `Basic ${credentials}`;
          }
        }
        break;

      case 'oauth2':
        if (this.securityConfig.oauth2?.token) {
          this.setAuthorizationHeader(this.securityConfig.oauth2.token);
        }
        break;

      case 'openIdConnect':
        if (this.securityConfig.openIdConnect?.token) {
          this.setAuthorizationHeader(this.securityConfig.openIdConnect.token);
        }
        break;
    }
  }

  private setAuthorizationHeader(token?: string): void {
    if (token) {
      this.httpClient.defaults.headers.common['Authorization'] = 'Bearer ' + token;
      return;
    }

    delete this.httpClient.defaults.headers.common['Authorization'];
  }

  private getOAuth2Config(): OpenAPIOAuth2Config | undefined {
    return this.securityConfig?.type === 'oauth2' ? this.securityConfig.oauth2 : undefined;
  }

  private getDefaultAuthorizationHeader(): string | undefined {
    const authorization = this.httpClient.defaults?.headers?.common?.['Authorization'];
    return typeof authorization === 'string' ? authorization : undefined;
  }

  private async invalidateRefreshableOAuth2Token(): Promise<boolean> {
    const oauth2 = this.getOAuth2Config();
    if (!oauth2?.tokenUrl || !oauth2.clientId) {
      return false;
    }

    delete oauth2.token;
    delete oauth2.expiresAt;

    if (this.config.openapi?.security?.oauth2) {
      this.config.openapi.security.oauth2 = oauth2;
    }

    this.setAuthorizationHeader(undefined);
    await this.persistOAuth2Token?.({ ...oauth2 });
    return true;
  }

  private hasValidOAuth2Token(oauth2: OpenAPIOAuth2Config): boolean {
    if (!oauth2.token) {
      return false;
    }

    if (typeof oauth2.expiresAt !== 'number') {
      return true;
    }

    return oauth2.expiresAt > Date.now() + 30_000;
  }

  private async updateOAuth2TokenState(token: string, expiresAt?: number): Promise<void> {
    const oauth2 = this.getOAuth2Config();
    if (!oauth2) {
      return;
    }

    oauth2.token = token;

    if (typeof expiresAt === 'number') {
      oauth2.expiresAt = expiresAt;
    } else {
      delete oauth2.expiresAt;
    }

    if (this.config.openapi?.security?.oauth2) {
      this.config.openapi.security.oauth2 = oauth2;
    }

    this.setAuthorizationHeader(token);
    await this.persistOAuth2Token?.(oauth2);
  }

  private async fetchOAuth2ClientCredentialsToken(oauth2: OpenAPIOAuth2Config): Promise<string> {
    if (!oauth2.tokenUrl || !oauth2.clientId) {
      throw new Error('OAuth2 client credentials require both tokenUrl and clientId');
    }

    const body = new URLSearchParams({
      grant_type: 'client_credentials',
      client_id: oauth2.clientId,
    });

    if (oauth2.clientSecret) {
      body.set('client_secret', oauth2.clientSecret);
    }

    if (Array.isArray(oauth2.scopes) && oauth2.scopes.length > 0) {
      body.set('scope', oauth2.scopes.join(' '));
    }

    // Validate OAuth token endpoints with the same owner-scoped SSRF policy as
    // specification and tool requests. This is especially important for the
    // unsaved preview endpoint, which accepts the complete OpenAPI config.
    const safeTokenUrl = await assertSafeUrl(oauth2.tokenUrl, {
      allowInternal: this.allowInternalNetworks,
    });

    const response = await this.httpClient.request({
      method: 'post',
      url: safeTokenUrl,
      baseURL: undefined,
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      data: body.toString(),
    });

    const tokenResponse = response.data as {
      access_token?: string;
      expires_in?: number;
    };

    if (!tokenResponse?.access_token) {
      throw new Error('OAuth2 token endpoint did not return an access_token');
    }

    const expiresAt =
      typeof tokenResponse.expires_in === 'number' && tokenResponse.expires_in > 0
        ? Date.now() + tokenResponse.expires_in * 1000
        : undefined;

    await this.updateOAuth2TokenState(tokenResponse.access_token, expiresAt);
    return tokenResponse.access_token;
  }

  private async ensureOAuth2AccessToken(): Promise<string | undefined> {
    const oauth2 = this.getOAuth2Config();
    if (!oauth2) {
      return undefined;
    }

    if (this.hasValidOAuth2Token(oauth2)) {
      this.setAuthorizationHeader(oauth2.token);
      return oauth2.token;
    }

    if (!oauth2.tokenUrl || !oauth2.clientId) {
      if (oauth2.token) {
        this.setAuthorizationHeader(oauth2.token);
      }
      return oauth2.token;
    }

    if (!this.oauth2TokenRequest) {
      this.oauth2TokenRequest = this.fetchOAuth2ClientCredentialsToken(oauth2).finally(() => {
        this.oauth2TokenRequest = undefined;
      });
    }

    return this.oauth2TokenRequest;
  }

  async initialize(): Promise<void> {
    try {
      // Resolve whether this server's owner is an admin first; admin-owned
      // servers may legitimately target internal services and skip the SSRF
      // blocklist. Needed before the URL fetch so the spec-download guard is
      // scoped the same way as callTool's.
      const ownerUser = this.config.owner
        ? await getUserDao().findByUsername(this.config.owner)
        : null;
      this.allowInternalNetworks = !!ownerUser?.isAdmin;

      // Obtain/refresh the OAuth2 access token up front so it authenticates the
      // document download (for url configs) and is ready for later API calls.
      // No-op when no OAuth2 security is configured.
      await this.ensureOAuth2AccessToken();

      // Reset the external-$ref guard marker so a rejection from THIS
      // dereference pass is never confused with a stale one.
      this.refGuardRejection = undefined;

      // Parse and dereference the OpenAPI specification
      if (this.config.openapi?.url) {
        // Fetch the document through the authenticated httpClient (carries
        // config.headers + security credentials from setupSecurity, and uses
        // maxRedirects: 0 so credentials are never forwarded across a
        // cross-origin redirect). SwaggerParser's own resolver is bypassed for
        // the main document so its (unauthenticated) headers never see the
        // credentials; external $ref resolution still uses that resolver and
        // therefore receives no auth by default.
        const specUrl = this.config.openapi.url;
        const safeSpecUrl = await assertSafeUrl(specUrl, {
          allowInternal: this.allowInternalNetworks,
        });
        const requestConfig: AxiosRequestConfig = {
          responseType: 'text',
          transformResponse: [(data: unknown) => data],
        };
        // The static apiKey.in:'cookie' value is otherwise only injected in
        // callTool; apply it here too so cookie-protected spec URLs load.
        if (this.staticCookieHeader) {
          requestConfig.headers = { Cookie: this.staticCookieHeader };
        }
        const response = await this.httpClient.get(safeSpecUrl, requestConfig);
        const raw = typeof response.data === 'string' ? response.data : String(response.data);
        this.spec = (await SwaggerParser.dereference(
          safeSpecUrl,
          this.parseSpecDocument(raw),
          this.guardedRefResolveOptions(),
        )) as OpenAPIV3.Document;
      } else if (this.config.openapi?.schema) {
        // For schema object, we need to pass it as a cloned object
        this.spec = (await SwaggerParser.dereference(
          JSON.parse(JSON.stringify(this.config.openapi.schema)),
          this.guardedRefResolveOptions(),
        )) as OpenAPIV3.Document;
      } else {
        throw new Error('Either OpenAPI URL or schema must be provided');
      }

      // Update baseUrl from OpenAPI servers field
      this.updateBaseUrlFromServers();

      this.extractTools();
    } catch (error) {
      // Let SSRF rejections propagate as-is so callers can distinguish a blocked
      // target from a parse/auth failure (matches callTool's handling).
      if (error instanceof UnsafeUrlError) {
        throw error;
      }
      // SwaggerParser wraps resolver failures (including our SSRF guard
      // rejections) in its own ResolverError and drops the cause — surface the
      // real UnsafeUrlError when the guarded $ref resolver flagged one.
      if (this.refGuardRejection) {
        throw this.refGuardRejection;
      }
      const errorMessage = error instanceof Error ? error.message : String(error);
      throw new Error(
        `Failed to load OpenAPI specification: ${sanitizeStringForLogging(errorMessage)}`,
      );
    }
  }

  // Parse a fetched spec body into an object. JSON first (stricter errors for
  // malformed JSON), YAML fallback so protected YAML documents work without
  // relying on SwaggerParser's own fetch (which cannot carry our credentials).
  private parseSpecDocument(raw: string): any {
    try {
      return JSON.parse(raw);
    } catch {
      return yaml.load(raw);
    }
  }

  // SwaggerParser options that replace its built-in resolvers so EVERY external
  // $ref target is validated by the SSRF guard before any request leaves the
  // process. Without this, a non-admin-supplied spec could point $refs at
  // internal addresses (IMDS, RFC1918, loopback) or local files and have their
  // contents embedded into the dereferenced schema served back to clients.
  // Admin-owned servers keep the same allowInternal escape hatch as the main
  // document download and callTool.
  private guardedRefResolveOptions(): Record<string, unknown> {
    const rejectUnsafe = (err: UnsafeUrlError): never => {
      this.refGuardRejection = err;
      throw err;
    };
    return {
      resolve: {
        http: {
          order: 1,
          canRead: (file: { url: string }) => /^https?:\/\//i.test(file.url),
          read: async (file: { url: string }): Promise<string> => {
            let safeRefUrl: string;
            try {
              safeRefUrl = await assertSafeUrl(file.url, {
                allowInternal: this.allowInternalNetworks,
              });
            } catch (error) {
              rejectUnsafe(error as UnsafeUrlError);
              return '';
            }
            // Plain fetch, NOT this.httpClient: default auth headers and
            // interceptors must never be forwarded cross-origin to $ref
            // targets (#1044). Redirects are followed manually with every hop
            // re-validated by the guard.
            const safeFetch = createRedirectValidatingFetch(
              (url, init) => fetch(url, init),
              this.allowInternalNetworks,
            );
            const response = await safeFetch(safeRefUrl, { method: 'GET', headers: {} });
            const buf = await response.arrayBuffer();
            return new TextDecoder().decode(buf);
          },
        },
        file: {
          order: 1,
          canRead: true,
          read: async (file: { url: string }): Promise<string> => {
            if (!this.allowInternalNetworks) {
              rejectUnsafe(
                new UnsafeUrlError(
                  `Blocked local file reference in specification: ${sanitizeStringForLogging(file.url)}`,
                ),
              );
            }
            return readFile(new URL(file.url), 'utf8');
          },
        },
      },
    };
  }

  private generateOperationName(method: string, path: string): string {
    // Clean path, remove parameter brackets and special characters
    const cleanPath = path
      .replace(/\{[^}]+\}/g, '') // Remove {param} format parameters
      .replace(/[^\w/]/g, '') // Remove special characters, keep alphanumeric and slashes
      .split('/')
      .filter((segment) => segment.length > 0) // Remove empty segments
      .map((segment) => segment.toLowerCase()) // Convert to lowercase
      .join('_'); // Join with underscores

    // Convert method to lowercase and combine with path
    const methodName = method.toLowerCase();
    return `${methodName}_${cleanPath || 'root'}`;
  }

  private updateBaseUrlFromServers(): void {
    if (!this.spec?.servers || this.spec.servers.length === 0) {
      return;
    }

    // Get the first server's URL
    const server = this.spec.servers[0];
    let serverUrl = server.url;

    // OpenAPI server URLs may contain {variable} templates that must be
    // substituted with the variable's `default` before use (e.g. seerr declares
    // `url: '{server}/api/v1'` with `variables.server.default`). Without
    // substitution the literal '{server}/api/v1' is misclassified as a relative
    // path and glued onto the spec source host, 404-ing every tool call.
    if (server.variables) {
      for (const [name, variable] of Object.entries(server.variables)) {
        if (variable?.default !== undefined) {
          serverUrl = serverUrl.split(`{${name}}`).join(variable.default);
        }
      }
    }

    // If it's a relative path, combine with original spec URL
    if (serverUrl.startsWith('/')) {
      // Relative path, use protocol and host from original spec URL
      if (this.config.openapi?.url) {
        const originalUrl = new URL(this.config.openapi.url);
        this.baseUrl = `${originalUrl.protocol}//${originalUrl.host}${serverUrl}`;
      }
    } else if (serverUrl.startsWith('http://') || serverUrl.startsWith('https://')) {
      // Absolute path
      this.baseUrl = serverUrl;
    } else {
      // Relative path but doesn't start with /, might be relative to current path
      if (this.config.openapi?.url) {
        const originalUrl = new URL(this.config.openapi.url);
        this.baseUrl = `${originalUrl.protocol}//${originalUrl.host}/${serverUrl}`;
      }
    }

    // Update HTTP client's baseURL
    this.httpClient.defaults.baseURL = this.baseUrl;
  }

  private extractTools(): void {
    if (!this.spec?.paths) {
      return;
    }

    this.tools = [];
    const generatedNames = new Set<string>(); // Used to ensure generated names are unique

    for (const [path, pathItem] of Object.entries(this.spec.paths)) {
      if (!pathItem) continue;

      const methods = [
        'get',
        'post',
        'put',
        'delete',
        'patch',
        'head',
        'options',
        'trace',
      ] as const;

      for (const method of methods) {
        const operation = pathItem[method] as OpenAPIV3.OperationObject | undefined;
        if (!operation) continue;

        // Generate operation name: use operationId first, otherwise generate unique name
        let operationName: string;
        if (operation.operationId) {
          operationName = operation.operationId;
        } else {
          operationName = this.generateOperationName(method, path);

          // Ensure name uniqueness, add numeric suffix if duplicate
          let uniqueName = operationName;
          let counter = 1;
          while (generatedNames.has(uniqueName) || this.tools.some((t) => t.name === uniqueName)) {
            uniqueName = `${operationName}${counter}`;
            counter++;
          }
          operationName = uniqueName;
        }

        generatedNames.add(operationName);

        // Resolve the operation's declared request-body content type once so
        // schema advertisement below and outgoing serialization in callTool
        // stay symmetric (#1078).
        const declaredRequestBody =
          operation.requestBody && 'content' in operation.requestBody
            ? (operation.requestBody as OpenAPIV3.RequestBodyObject)
            : undefined;
        const requestBodySelection = selectRequestBodyContent(declaredRequestBody);

        let description =
          operation.summary || operation.description || `${method.toUpperCase()} ${path}`;

        // A body whose content type the hub cannot serialize used to produce a
        // silent zero-argument tool that models would retry forever. Mark such
        // operations visibly in the description instead (#1078).
        if (declaredRequestBody && !requestBodySelection) {
          const declaredTypes = Object.keys(declaredRequestBody.content ?? {}).join(', ');
          description += ` [Unsupported request body content type(s): ${declaredTypes} — only application/json, application/x-www-form-urlencoded and multipart/form-data can be sent by MCPHub.]`;
        }

        const tool: OpenAPIToolInfo = {
          name: operationName,
          description,
          // SwaggerParser.dereference turns recursive $ref schemas into live
          // circular references on the dereferenced spec objects. generateInputSchema
          // references those objects directly, so without sanitization every
          // downstream serializer (tokenCost, getServerConfig, MCP ListTools,
          // embeddings) throws "Converting circular structure to JSON". See #959.
          inputSchema: createSafeJSON(
            this.generateInputSchema(operation, path, method as string, requestBodySelection),
          ),
          operationId: operation.operationId || operationName,
          method: method as string,
          path,
          parameters: operation.parameters as OpenAPIV3.ParameterObject[],
          requestBody: operation.requestBody as OpenAPIV3.RequestBodyObject,
          responses: operation.responses,
        };

        this.tools.push(tool);
      }
    }
  }

  private generateInputSchema(
    operation: OpenAPIV3.OperationObject,
    _path: string,
    _method: string,
    requestBodySelection: RequestBodyContentSelection | null,
  ): Record<string, unknown> {
    const schema: Record<string, unknown> = {
      type: 'object',
      properties: {},
      required: [],
    };

    const properties = schema.properties as Record<string, unknown>;
    const required = schema.required as string[];

    // Handle path parameters
    const pathParams = operation.parameters?.filter(
      (p: any) => 'in' in p && p.in === 'path',
    ) as OpenAPIV3.ParameterObject[];

    if (pathParams?.length) {
      for (const param of pathParams) {
        properties[param.name] = this.generateParameterSchema(
          param,
          `Path parameter: ${param.name}`,
        );
        if (param.required) {
          required.push(param.name);
        }
      }
    }

    // Handle query parameters
    const queryParams = operation.parameters?.filter(
      (p: any) => 'in' in p && p.in === 'query',
    ) as OpenAPIV3.ParameterObject[];

    if (queryParams?.length) {
      for (const param of queryParams) {
        properties[param.name] = this.generateParameterSchema(
          param,
          `Query parameter: ${param.name}`,
        );
        if (param.required) {
          required.push(param.name);
        }
      }
    }

    // Handle header parameters. callTool() already copies `in: header`
    // arguments into the outgoing request, so they must be advertised here too,
    // otherwise an operation whose per-call credential is a header is exposed
    // as a zero-argument tool the model cannot supply a value for.
    const headerParams = operation.parameters?.filter(
      (p: any) => 'in' in p && p.in === 'header',
    ) as OpenAPIV3.ParameterObject[];

    if (headerParams?.length) {
      for (const param of headerParams) {
        properties[param.name] = this.generateParameterSchema(
          param,
          `Header parameter: ${param.name}`,
        );
        if (param.required) {
          required.push(param.name);
        }
      }
    }

    // Handle request body. The advertised schema must match what callTool can
    // serialize, so key off the same resolved content type selection (#1078):
    // JSON and urlencoded bodies are exposed as-is; multipart bodies are
    // rewritten so binary fields accept base64-encoded strings.
    if (operation.requestBody && 'content' in operation.requestBody && requestBodySelection) {
      const requestBody = operation.requestBody as OpenAPIV3.RequestBodyObject;
      const selectedSchema = requestBodySelection.mediaType.schema;

      if (selectedSchema) {
        properties['body'] =
          requestBodySelection.contentType === 'multipart/form-data'
            ? makeMultipartBodySchemaModelFriendly(selectedSchema)
            : selectedSchema;
        if (requestBody.required) {
          required.push('body');
        }
      }
    }

    return schema;
  }

  private generateParameterSchema(
    param: OpenAPIV3.ParameterObject,
    fallbackDescription: string,
  ): OpenAPIV3.SchemaObject {
    const parameterSchema: OpenAPIV3.SchemaObject =
      param.schema && !('$ref' in param.schema) ? { ...param.schema } : { type: 'string' };

    if (param.description) {
      parameterSchema.description = param.description;
    } else if (!parameterSchema.description) {
      parameterSchema.description = fallbackDescription;
    }

    if (param.example !== undefined) {
      parameterSchema.example = param.example;
    }

    return parameterSchema;
  }

  async callTool(
    toolName: string,
    args: Record<string, unknown>,
    passthroughHeaders?: Record<string, string>,
    hasRetriedAfterUnauthorized = false,
    sessionId?: string,
  ): Promise<unknown> {
    const tool = this.tools.find((t) => t.name === toolName);
    if (!tool) {
      throw new Error(`Tool '${toolName}' not found`);
    }

    let attemptedUpstreamRequest = false;
    let authorizationUsedForRequest: string | undefined;
    let resolvedTarget: URL | null = null;

    try {
      await this.ensureOAuth2AccessToken();

      // Build the request URL with path parameters
      let url = tool.path;
      const pathParams = tool.parameters?.filter((p) => p.in === 'path') || [];

      for (const param of pathParams) {
        const value = args[param.name];
        if (value === undefined || value === null) {
          // Path parameters are required by the OpenAPI spec; fail fast rather
          // than sending a request whose `{placeholder}` can only 404 (#1083).
          throw new Error(`Required path parameter '${param.name}' is missing`);
        }
        // Values come from model output, so encode them to keep URL-significant
        // characters ('/', '?', '#', '%') from changing the endpoint (#1083).
        url = url.replace(`{${param.name}}`, encodePathParameterValue(value));
      }

      // Build query parameters
      const queryParams: Record<string, unknown> = {};
      const queryParamDefs = tool.parameters?.filter((p) => p.in === 'query') || [];

      for (const param of queryParamDefs) {
        const value = args[param.name];
        if (value !== undefined) {
          queryParams[param.name] = value;
        }
      }

      // Prepare request configuration
      const requestConfig: AxiosRequestConfig = {
        method: tool.method as any,
        url,
        params: queryParams,
      };

      // Add request body if applicable. Key off the operation's own spec rather
      // than a method allowlist: some APIs declare required bodies on DELETE
      // (bulk deletes), and RFC 9110 §9.3.5 permits content when the origin
      // server has indicated support for it — which a requestBody declaration
      // in its OpenAPI document is. Keeps schema advertisement and sending
      // symmetric (#1084). The body is serialized according to the content type
      // resolved from the same spec the tool schema was built from (#1078).
      let requestBodyContentType: string | undefined;
      if (args.body !== undefined && tool.requestBody) {
        const selection = selectRequestBodyContent(tool.requestBody);
        if (!selection) {
          const declaredTypes = Object.keys(tool.requestBody.content ?? {}).join(', ');
          throw new Error(
            `Tool '${toolName}' declares a request body with unsupported content type(s): ${declaredTypes}. Only application/json, application/x-www-form-urlencoded and multipart/form-data can be sent by MCPHub.`,
          );
        }

        switch (selection.contentType) {
          case 'application/json':
            requestConfig.data = args.body;
            break;
          case 'application/x-www-form-urlencoded':
            requestConfig.data = encodeFormUrlEncoded(args.body);
            requestBodyContentType = 'application/x-www-form-urlencoded';
            break;
          case 'multipart/form-data': {
            const boundary = `----MCPHubBoundary${randomUUID().replace(/-/g, '')}`;
            // The spec is dereferenced before tools are built, so the schema
            // cannot still be a $ref here.
            const bodySchema = selection.mediaType.schema as OpenAPIV3.SchemaObject | undefined;
            const parts = buildMultipartParts(args.body, bodySchema);
            requestConfig.data = serializeMultipartBody(parts, boundary);
            // The boundary must travel with the header, so it is set explicitly
            // per request rather than left to axios.
            requestBodyContentType = `multipart/form-data; boundary=${boundary}`;
            break;
          }
        }
      }

      // Collect all headers to be sent
      const allHeaders: Record<string, string> = {};

      // Add headers if any header parameters are defined
      const headerParams = tool.parameters?.filter((p) => p.in === 'header') || [];
      for (const param of headerParams) {
        const value = args[param.name];
        if (value !== undefined) {
          allHeaders[param.name] = String(value);
        }
      }

      // Add passthrough headers based on configuration
      if (passthroughHeaders && this.config.openapi?.passthroughHeaders) {
        for (const headerName of this.config.openapi.passthroughHeaders) {
          if (passthroughHeaders[headerName]) {
            allHeaders[headerName] = passthroughHeaders[headerName];
          }
        }
      }

      // Form and multipart bodies override the client-wide JSON Content-Type
      // default for this request only (#1078).
      if (requestBodyContentType) {
        allHeaders['Content-Type'] = requestBodyContentType;
      }

      // Set headers if any were collected
      if (Object.keys(allHeaders).length > 0) {
        requestConfig.headers = allHeaders;
      }

      // SSRF guard: reject requests whose resolved target resolves to an
      // internal/loopback/link-local address. The baseURL and tool path are
      // both attacker-influenced (via the OpenAPI spec), so validate the
      // final URL rather than trusting either alone.
      resolvedTarget = null;
      try {
        resolvedTarget = new URL(String(requestConfig.url ?? '/'), this.baseUrl || undefined);
      } catch {
        // relative path with no base — no host to validate; axios surfaces the error
      }
      if (resolvedTarget) {
        const safeTargetUrl = await assertSafeUrl(resolvedTarget.href, {
          allowInternal: this.allowInternalNetworks,
        });
        const safeTarget = new URL(safeTargetUrl);
        requestConfig.baseURL = safeTarget.origin;
        requestConfig.url = `${safeTarget.pathname}${safeTarget.search}`;
      }

      const cookieSessionEnabled = this.isCookieSessionEnabled(sessionId);
      // Inject cookies when either the dynamic session store is active for this
      // call or a static `apiKey.in: 'cookie'` is configured (static cookies
      // apply to every request regardless of session).
      if ((cookieSessionEnabled || this.staticCookieHeader) && resolvedTarget) {
        this.applyRequestCookies(
          requestConfig,
          resolvedTarget.href,
          cookieSessionEnabled ? sessionId : undefined,
        );
      }

      authorizationUsedForRequest = this.getDefaultAuthorizationHeader();
      attemptedUpstreamRequest = true;
      const response = await this.httpClient.request(requestConfig);

      if (cookieSessionEnabled && resolvedTarget) {
        this.captureResponseCookies(response, resolvedTarget.href, sessionId);
      }

      return response.data;
    } catch (error) {
      if (axios.isAxiosError(error)) {
        // Capture Set-Cookie from non-2xx responses too. With maxRedirects: 0,
        // a 3xx login redirect is surfaced as an error; 4xx logout responses
        // may expire cookies. Capture before retry/rethrow so the jar stays
        // current and the 401-retry path can re-inject updated cookies.
        if (this.isCookieSessionEnabled(sessionId) && resolvedTarget && error.response) {
          this.captureResponseCookies(error.response, resolvedTarget.href, sessionId);
        }
        if (
          attemptedUpstreamRequest &&
          error.response?.status === 401 &&
          !hasRetriedAfterUnauthorized &&
          authorizationUsedForRequest &&
          authorizationUsedForRequest !== this.getDefaultAuthorizationHeader()
        ) {
          return this.callTool(toolName, args, passthroughHeaders, true, sessionId);
        }

        if (
          attemptedUpstreamRequest &&
          error.response?.status === 401 &&
          !hasRetriedAfterUnauthorized &&
          (await this.invalidateRefreshableOAuth2Token())
        ) {
          return this.callTool(toolName, args, passthroughHeaders, true, sessionId);
        }

        const status = error.response?.status ?? 'unknown';
        const statusText = error.response?.statusText ?? 'Unknown Error';
        const responseData = error.response?.data;
        let responseDetails = '';

        if (responseData !== undefined && responseData !== null && responseData !== '') {
          if (typeof responseData === 'string') {
            responseDetails = responseData;
          } else {
            try {
              responseDetails = JSON.stringify(responseData);
            } catch {
              responseDetails = String(responseData);
            }
          }
        }

        responseDetails = sanitizeStringForLogging(responseDetails);
        throw new Error(
          `API call failed: ${status} ${statusText}${responseDetails ? ` ${responseDetails}` : ''}`,
        );
      }
      throw error;
    }
  }

  getTools(): OpenAPIToolInfo[] {
    return this.tools;
  }

  getSpec(): OpenAPIV3.Document | null {
    return this.spec;
  }

  private isCookieSessionEnabled(sessionId?: string): sessionId is string {
    return (
      !!this.config.openapi?.cookieSession && typeof sessionId === 'string' && sessionId.length > 0
    );
  }

  // Lazily create a per-session cookie jar, seeded with the static apiKey
  // cookie (if any) so it applies to every request and can be overridden by a
  // dynamic Set-Cookie of the same name.
  private getCookieJar(sessionId: string): CookieJar {
    let jar = this.cookieJars.get(sessionId);
    if (jar) {
      return jar;
    }

    // Backstop: evict the oldest jar before exceeding the cap. Session-end
    // cleanup is the primary eviction path; this guards against leaks when a
    // session is abandoned without an explicit close.
    if (this.cookieJars.size >= OpenAPIClient.MAX_COOKIE_JARS) {
      const oldest = this.cookieJars.keys().next().value;
      if (oldest !== undefined) {
        this.cookieJars.delete(oldest);
      }
    }

    jar = new CookieJar();
    if (this.staticCookieHeader && this.baseUrl) {
      try {
        jar.setCookieSync(`${this.staticCookieHeader}; Path=/`, this.baseUrl);
      } catch {
        // ignore malformed static cookie / unsuitable baseUrl
      }
    }
    this.cookieJars.set(sessionId, jar);
    return jar;
  }

  // Apply stored cookies to an outgoing request. When a session jar exists,
  // use it (it already includes any seeded static cookie and captured dynamic
  // cookies). Otherwise fall back to the static `apiKey.in: 'cookie'` value so
  // static cookie auth works without opting into session handling.
  private applyRequestCookies(
    requestConfig: AxiosRequestConfig,
    requestUrl: string,
    sessionId?: string,
  ): void {
    let cookieString = '';
    if (sessionId) {
      const jar = this.cookieJars.get(sessionId);
      if (jar) {
        try {
          cookieString = jar.getCookieStringSync(requestUrl);
        } catch {
          return;
        }
      } else if (this.staticCookieHeader) {
        cookieString = this.staticCookieHeader;
      }
    } else if (this.staticCookieHeader) {
      cookieString = this.staticCookieHeader;
    }

    if (cookieString) {
      const existingHeaders = requestConfig.headers as Record<string, string> | undefined;
      const merged = OpenAPIClient.mergeCookieHeader(existingHeaders?.Cookie, cookieString);
      requestConfig.headers = {
        ...existingHeaders,
        Cookie: merged,
      };
    }
  }

  // Merge two Cookie header strings, with `additional` (jar/static) values
  // winning for duplicate names so caller-configured cookies are preserved.
  private static mergeCookieHeader(existing: string | undefined, additional: string): string {
    const entries = new Map<string, string>();
    const parse = (header: string) => {
      for (const part of header.split(';')) {
        const trimmed = part.trim();
        if (!trimmed) {
          continue;
        }
        const eq = trimmed.indexOf('=');
        if (eq <= 0) {
          continue;
        }
        entries.set(trimmed.slice(0, eq).trim(), trimmed.slice(eq + 1));
      }
    };
    if (existing) {
      parse(existing);
    }
    parse(additional);
    return [...entries].map(([k, v]) => `${k}=${v}`).join('; ');
  }

  // Capture Set-Cookie headers from an upstream response into the session jar.
  private captureResponseCookies(
    response: AxiosResponse,
    requestUrl: string,
    sessionId: string,
  ): void {
    const setCookie = response.headers?.['set-cookie'];
    if (!setCookie) {
      return;
    }
    const jar = this.getCookieJar(sessionId);
    const headers = Array.isArray(setCookie) ? setCookie : [setCookie];
    for (const header of headers) {
      try {
        jar.setCookieSync(header, requestUrl);
      } catch {
        // skip unparseable Set-Cookie rather than failing the tool call
      }
    }
  }

  // Drop the cookie jar for a session. Called from session-end cleanup.
  clearSessionCookies(sessionId: string): void {
    this.cookieJars.delete(sessionId);
  }

  disconnect(): void {
    // No persistent connection to close for OpenAPI
    this.cookieJars.clear();
  }
}
