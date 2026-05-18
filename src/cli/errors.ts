// Errors thrown by the CLI layer. Top-level handler in main.ts inspects the
// constructor (or `requiresLogin` flag) to choose an exit code and decide
// whether to print remediation hints.

export class CliUsageError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'CliUsageError';
  }
}

export interface CliApiErrorInit {
  status: number;
  message: string;
  body?: unknown;
  requiresLogin?: boolean;
}

export class CliApiError extends Error {
  readonly status: number;
  readonly body: unknown;
  readonly requiresLogin: boolean;

  constructor(init: CliApiErrorInit) {
    super(init.message);
    this.name = 'CliApiError';
    this.status = init.status;
    this.body = init.body;
    this.requiresLogin = init.requiresLogin ?? init.status === 401;
  }
}
