import axios, { AxiosInstance, AxiosRequestConfig } from 'axios';
import SwaggerParser from '@apidevtools/swagger-parser';
import { OpenAPIV3 } from 'openapi-types';
import { ServerConfig, OpenAPISecurityConfig } from '../types/index.js';

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

export class OpenAPIClient {
  private httpClient: AxiosInstance;
  private spec: OpenAPIV3.Document | null = null;
  private tools: OpenAPIToolInfo[] = [];
  private baseUrl: string;
  private securityConfig?: OpenAPISecurityConfig;

  constructor(private config: ServerConfig) {
    if (!config.openapi?.url && !config.openapi?.schema) {
      throw new Error('OpenAPI URL or schema is required');
    }

    // Initial baseUrl, will be updated from OpenAPI servers field in initialize()
    this.baseUrl = config.openapi?.url ? this.extractBaseUrl(config.openapi.url) : '';
    this.securityConfig = config.openapi.security;

    this.httpClient = axios.create({
      baseURL: this.baseUrl,
      timeout: config.options?.timeout || 30000,
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
          this.httpClient.defaults.headers.common['Authorization'] =
            `Bearer ${this.securityConfig.oauth2.token}`;
        }
        break;

      case 'openIdConnect':
        if (this.securityConfig.openIdConnect?.token) {
          this.httpClient.defaults.headers.common['Authorization'] =
            `Bearer ${this.securityConfig.openIdConnect.token}`;
        }
        break;
    }
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

      this.extractTools();
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
        properties[param.name] = {
          type: 'string',
          description: param.description || `Path parameter: ${param.name}`,
        };
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
        properties[param.name] = param.schema || {
          type: 'string',
          description: param.description || `Query parameter: ${param.name}`,
        };
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

  async callTool(toolName: string, args: Record<string, unknown>): Promise<unknown> {
    const tool = this.tools.find((t) => t.name === toolName);
    if (!tool) {
      throw new Error(`Tool '${toolName}' not found`);
    }

    try {
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

      // Add headers if any header parameters are defined
      const headerParams = tool.parameters?.filter((p) => p.in === 'header') || [];
      if (headerParams.length > 0) {
        requestConfig.headers = {};
        for (const param of headerParams) {
          const value = args[param.name];
          if (value !== undefined) {
            requestConfig.headers[param.name] = String(value);
          }
        }
      }

      const response = await this.httpClient.request(requestConfig);
      return response.data;
    } catch (error) {
      if (axios.isAxiosError(error)) {
        throw new Error(
          `API call failed: ${error.response?.status} ${error.response?.statusText} - ${JSON.stringify(error.response?.data)}`,
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
