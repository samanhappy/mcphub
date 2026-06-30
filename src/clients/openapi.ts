import axios, { AxiosInstance, AxiosRequestConfig } from 'axios';
import SwaggerParser from '@apidevtools/swagger-parser';
import { OpenAPIV3 } from 'openapi-types';
import { ServerConfig, OpenAPISecurityConfig } from '../types/index.js';
import { assertSafeUrl } from '../utils/ssrf.js';
import { getUserDao } from '../dao/index.js';
import { sanitizeStringForLogging } from '../utils/serialization.js';

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
  persistOAuth2Token?: (oauth2: OpenAPIOAuth2Config) => Promise<void> | void;
}

export class OpenAPIClient {
  private httpClient: AxiosInstance;
  private spec: OpenAPIV3.Document | null = null;
  private tools: OpenAPIToolInfo[] = [];
  private baseUrl: string;
  private securityConfig?: OpenAPISecurityConfig;
  private readonly persistOAuth2Token?: OpenAPIClientOptions['persistOAuth2Token'];
  private oauth2TokenRequest?: Promise<string | undefined>;
  // Resolved in initialize(): admin-owned servers may target internal services
  // and skip the SSRF internal-IP blocklist.
  private allowInternalNetworks = false;

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
          }
          // Note: Cookie authentication would need additional setup
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

    const response = await this.httpClient.request({
      method: 'post',
      url: oauth2.tokenUrl,
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
      // Parse and dereference the OpenAPI specification
      if (this.config.openapi?.url) {
        this.spec = (await SwaggerParser.dereference(
          this.config.openapi.url,
        )) as OpenAPIV3.Document;
      } else if (this.config.openapi?.schema) {
        // For schema object, we need to pass it as a cloned object
        this.spec = (await SwaggerParser.dereference(
          JSON.parse(JSON.stringify(this.config.openapi.schema)),
        )) as OpenAPIV3.Document;
      } else {
        throw new Error('Either OpenAPI URL or schema must be provided');
      }

      // Update baseUrl from OpenAPI servers field
      this.updateBaseUrlFromServers();

      // Resolve whether this server's owner is an admin; admin-owned servers
      // may legitimately target internal services and skip the SSRF blocklist.
      const ownerUser = this.config.owner
        ? await getUserDao().findByUsername(this.config.owner)
        : null;
      this.allowInternalNetworks = !!ownerUser?.isAdmin;

      this.extractTools();
      await this.ensureOAuth2AccessToken();
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      throw new Error(`Failed to load OpenAPI specification: ${errorMessage}`);
    }
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
    const serverUrl = this.spec.servers[0].url;

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

        const tool: OpenAPIToolInfo = {
          name: operationName,
          description:
            operation.summary || operation.description || `${method.toUpperCase()} ${path}`,
          inputSchema: this.generateInputSchema(operation, path, method as string),
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

    // Handle request body
    if (operation.requestBody && 'content' in operation.requestBody) {
      const requestBody = operation.requestBody as OpenAPIV3.RequestBodyObject;
      const jsonContent = requestBody.content?.['application/json'];

      if (jsonContent?.schema) {
        properties['body'] = jsonContent.schema;
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
  ): Promise<unknown> {
    const tool = this.tools.find((t) => t.name === toolName);
    if (!tool) {
      throw new Error(`Tool '${toolName}' not found`);
    }

    let attemptedUpstreamRequest = false;
    let authorizationUsedForRequest: string | undefined;

    try {
      await this.ensureOAuth2AccessToken();

      // Build the request URL with path parameters
      let url = tool.path;
      const pathParams = tool.parameters?.filter((p) => p.in === 'path') || [];

      for (const param of pathParams) {
        const value = args[param.name];
        if (value !== undefined) {
          url = url.replace(`{${param.name}}`, String(value));
        }
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

      // Add request body if applicable
      if (args.body && ['post', 'put', 'patch'].includes(tool.method)) {
        requestConfig.data = args.body;
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

      // Set headers if any were collected
      if (Object.keys(allHeaders).length > 0) {
        requestConfig.headers = allHeaders;
      }

      // SSRF guard: reject requests whose resolved target resolves to an
      // internal/loopback/link-local address. The baseURL and tool path are
      // both attacker-influenced (via the OpenAPI spec), so validate the
      // final URL rather than trusting either alone.
      let resolvedTarget: URL | null = null;
      try {
        resolvedTarget = new URL(String(requestConfig.url ?? '/'), this.baseUrl || undefined);
      } catch {
        // relative path with no base — no host to validate; axios surfaces the error
      }
      if (resolvedTarget) {
        await assertSafeUrl(resolvedTarget.href, {
          allowInternal: this.allowInternalNetworks,
        });
      }

      authorizationUsedForRequest = this.getDefaultAuthorizationHeader();
      attemptedUpstreamRequest = true;
      const response = await this.httpClient.request(requestConfig);
      return response.data;
    } catch (error) {
      if (axios.isAxiosError(error)) {
        if (
          attemptedUpstreamRequest &&
          error.response?.status === 401 &&
          !hasRetriedAfterUnauthorized &&
          authorizationUsedForRequest &&
          authorizationUsedForRequest !== this.getDefaultAuthorizationHeader()
        ) {
          return this.callTool(toolName, args, passthroughHeaders, true);
        }

        if (
          attemptedUpstreamRequest &&
          error.response?.status === 401 &&
          !hasRetriedAfterUnauthorized &&
          (await this.invalidateRefreshableOAuth2Token())
        ) {
          return this.callTool(toolName, args, passthroughHeaders, true);
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

  disconnect(): void {
    // No persistent connection to close for OpenAPI
  }
}
