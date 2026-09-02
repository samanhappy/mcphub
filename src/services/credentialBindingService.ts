import type {
  CredentialBinding,
  CredentialTemplate,
  CredentialValues,
  ServerConfig,
} from '../types/index.js';
import type { CredentialBindingDao } from '../dao/CredentialBindingDao.js';
import type { ServerConfigWithName, ServerDao } from '../dao/ServerDao.js';
import { getCredentialBindingDao, getServerDao } from '../dao/DaoFactory.js';
import {
  authorizationService,
  type RequestPrincipal,
} from './authorizationService.js';
import { decryptCredentialValues, encryptCredentialValues } from './credentialCrypto.js';

export class CredentialBindingError extends Error {
  constructor(
    message: string,
    readonly statusCode: number,
  ) {
    super(message);
    this.name = new.target.name;
  }
}

export class CredentialBindingAccessError extends CredentialBindingError {
  constructor() {
    super('Forbidden', 403);
  }
}

export class CredentialBindingValidationError extends CredentialBindingError {
  constructor(message: string) {
    super(message, 400);
  }
}

export class CredentialBindingRequiredError extends CredentialBindingError {
  constructor(serverName: string) {
    super(`Credential binding required for server '${serverName}'. Add it in My Credentials.`, 400);
  }
}

export interface CredentialBindingSummary {
  serverName: string;
  description?: string;
  owner?: string;
  type?: ServerConfig['type'];
  credentialTemplate: CredentialTemplate;
  complete: boolean;
  configured: {
    env?: Record<string, boolean>;
    headers?: Record<string, boolean>;
  };
  updatedAt?: string;
}

export interface ResolvedCredentialConfig {
  config: ServerConfigWithName;
  bindingVersion: string;
}

const hasTemplate = (
  server: ServerConfigWithName,
): server is ServerConfigWithName & { credentialTemplate: CredentialTemplate } =>
  Boolean(
    server.credentialTemplate &&
      (Object.keys(server.credentialTemplate.env || {}).length > 0 ||
        Object.keys(server.credentialTemplate.headers || {}).length > 0),
  );

const assertPrincipal = (principal: RequestPrincipal | null | undefined): RequestPrincipal => {
  if (!principal?.username) throw new CredentialBindingAccessError();
  return principal;
};

const configuredMap = (
  template: CredentialTemplate,
  values: CredentialValues,
): CredentialBindingSummary['configured'] => {
  const section = (kind: 'env' | 'headers') => {
    const names = Object.keys(template[kind] || {});
    if (names.length === 0) return undefined;
    return Object.fromEntries(names.map((name) => [name, Boolean(values[kind]?.[name])]));
  };
  return { env: section('env'), headers: section('headers') };
};

const isComplete = (template: CredentialTemplate, values: CredentialValues): boolean =>
  (['env', 'headers'] as const).every((kind) =>
    Object.keys(template[kind] || {}).every((name) => Boolean(values[kind]?.[name]?.trim())),
  );

const selectDeclaredValues = (
  template: CredentialTemplate,
  values: CredentialValues,
): CredentialValues => {
  const selected: CredentialValues = {};
  for (const kind of ['env', 'headers'] as const) {
    const names = Object.keys(template[kind] || {});
    const entries = names.flatMap((name) =>
      typeof values[kind]?.[name] === 'string' ? [[name, values[kind]![name]] as const] : [],
    );
    if (entries.length > 0) selected[kind] = Object.fromEntries(entries);
  }
  return selected;
};

const mergeSubmittedValues = (
  template: CredentialTemplate,
  current: CredentialValues,
  submitted: CredentialValues,
): CredentialValues => {
  const result: CredentialValues = {};
  for (const kind of ['env', 'headers'] as const) {
    const templateNames = new Set(Object.keys(template[kind] || {}));
    const supplied = submitted[kind];
    if (supplied !== undefined && (typeof supplied !== 'object' || Array.isArray(supplied))) {
      throw new CredentialBindingValidationError(`Credential ${kind} values must be an object`);
    }

    const merged: Record<string, string> = { ...(current[kind] || {}) };
    for (const [name, value] of Object.entries(supplied || {})) {
      if (!templateNames.has(name)) {
        throw new CredentialBindingValidationError(`Credential slot is not declared: ${kind}.${name}`);
      }
      if (typeof value !== 'string' || value.trim().length === 0) {
        throw new CredentialBindingValidationError(`Credential value is required: ${kind}.${name}`);
      }
      merged[name] = value;
    }

    if (Object.keys(merged).length > 0) result[kind] = merged;
  }

  if (!isComplete(template, result)) {
    throw new CredentialBindingValidationError('All required credential slots must be supplied');
  }
  return result;
};

export class CredentialBindingService {
  constructor(
    private readonly bindingDao: CredentialBindingDao = getCredentialBindingDao(),
    private readonly serverDao: ServerDao = getServerDao(),
  ) {}

  async listForPrincipal(principal: RequestPrincipal | null | undefined): Promise<CredentialBindingSummary[]> {
    const user = assertPrincipal(principal);
    const [servers, bindings] = await Promise.all([
      this.serverDao.findAll(),
      this.bindingDao.findByUsername(user.username),
    ]);
    const bindingsByServer = new Map(bindings.map((binding) => [binding.serverName, binding]));

    return servers
      .filter(hasTemplate)
      .filter((server) => authorizationService.can('server.invoke', server, user))
      .map((server) => this.toSummary(server, bindingsByServer.get(server.name)))
      .sort((a, b) => a.serverName.localeCompare(b.serverName));
  }

  async upsertForPrincipal(
    serverName: string,
    principal: RequestPrincipal | null | undefined,
    submitted: CredentialValues,
  ): Promise<CredentialBindingSummary> {
    const user = assertPrincipal(principal);
    const server = await this.getAuthorizedTemplatedServer(serverName, user);
    const existing = await this.bindingDao.findByServerAndUsername(serverName, user.username);
    const encryptionContext = { username: user.username };
    const current = existing
      ? selectDeclaredValues(
          server.credentialTemplate,
          decryptCredentialValues(existing.encryptedValues, encryptionContext),
        )
      : {};
    const values = mergeSubmittedValues(server.credentialTemplate, current, submitted || {});
    const binding = await this.bindingDao.upsert(
      serverName,
      user.username,
      encryptCredentialValues(values, encryptionContext),
    );
    return this.toSummary(server, binding, values);
  }

  async deleteForPrincipal(
    serverName: string,
    principal: RequestPrincipal | null | undefined,
  ): Promise<boolean> {
    const user = assertPrincipal(principal);
    await this.getAuthorizedTemplatedServer(serverName, user);
    return this.bindingDao.delete(serverName, user.username);
  }

  async resolveServerConfig(
    server: ServerConfigWithName,
    principal: RequestPrincipal | null | undefined,
  ): Promise<ResolvedCredentialConfig> {
    const user = assertPrincipal(principal);
    if (!hasTemplate(server) || !authorizationService.can('server.invoke', server, user)) {
      throw new CredentialBindingAccessError();
    }
    const binding = await this.bindingDao.findByServerAndUsername(server.name, user.username);
    if (!binding) throw new CredentialBindingRequiredError(server.name);
    const values = selectDeclaredValues(
      server.credentialTemplate,
      decryptCredentialValues(binding.encryptedValues, { username: user.username }),
    );
    if (!isComplete(server.credentialTemplate, values)) {
      throw new CredentialBindingRequiredError(server.name);
    }

    return {
      config: {
        ...structuredClone(server),
        env: { ...(server.env || {}), ...(values.env || {}) },
        headers: { ...(server.headers || {}), ...(values.headers || {}) },
      },
      bindingVersion: binding.updatedAt,
    };
  }

  private async getAuthorizedTemplatedServer(
    serverName: string,
    principal: RequestPrincipal,
  ): Promise<ServerConfigWithName & { credentialTemplate: CredentialTemplate }> {
    const server = await this.serverDao.findById(serverName);
    if (!server) throw new CredentialBindingValidationError('Server not found');
    if (!authorizationService.can('server.invoke', server, principal)) {
      throw new CredentialBindingAccessError();
    }
    if (!hasTemplate(server)) {
      throw new CredentialBindingValidationError('Server does not declare user credential slots');
    }
    return server;
  }

  private toSummary(
    server: ServerConfigWithName & { credentialTemplate: CredentialTemplate },
    binding?: CredentialBinding,
    resolvedValues?: CredentialValues,
  ): CredentialBindingSummary {
    const values =
      resolvedValues ??
      (binding
        ? decryptCredentialValues(binding.encryptedValues, {
            username: binding.username,
          })
        : {});
    return {
      serverName: server.name,
      description: server.description,
      owner: server.owner,
      type: server.type,
      credentialTemplate: structuredClone(server.credentialTemplate),
      complete: isComplete(server.credentialTemplate, values),
      configured: configuredMap(server.credentialTemplate, values),
      updatedAt: binding?.updatedAt,
    };
  }
}

export const credentialBindingService = new CredentialBindingService();
