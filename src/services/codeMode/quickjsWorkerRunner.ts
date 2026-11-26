/**
 * QuickJS-NG WebAssembly sandbox runner executed inside a Node.js `worker_threads` Worker.
 *
 * Isolation properties:
 * - Guest JS executes inside QuickJS-NG compiled to WebAssembly (`@jitl/quickjs-ng-wasmfile-release-sync`)
 *   with zero ambient Node/Web APIs (no `fs`, `net`, `process`, `fetch`, `require`, `import`, timers).
 * - Running WASM inside a worker thread keeps synchronous guest CPU loops off MCPHub's main
 *   event loop and allows hard termination via `worker.terminate()` on wall-clock timeout.
 * - Host `tools.search` and `tools.call` calls bridge over a `MessagePort` back to the main thread,
 *   where they execute inside the caller's live `AsyncLocalStorage` (`RequestContextService` +
 *   `UserContextService`) and reuse the full MCPHub authorization stack.
 */

import { MessageChannel, Worker } from 'node:worker_threads';
import { createRequire } from 'node:module';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import {
  CodeSandboxError,
  type CodeSandboxErrorKind,
  type CodeSandboxRunRequest,
  type CodeSandboxRunResult,
  type CodeSandboxRunner,
} from './types.js';

const resolvePackageFileUrl = (specifier: string): string => {
  const pkgRequire = createRequire(
    typeof __filename === 'string'
      ? __filename
      : pathToFileURL(path.join(process.cwd(), 'package.json')).href,
  );
  const resolved = pkgRequire.resolve(specifier);
  return pathToFileURL(resolved).href;
};

/**
 * Pure JavaScript worker script executed via `new Worker(WORKER_SOURCE, { eval: true })`.
 * Keeping the worker self-contained works identically under `node dist/index.js`, `tsx`,
 * and `ts-jest` without extra build-copy steps.
 */
const WORKER_SOURCE = `
const { workerData } = require('node:worker_threads');

(async () => {
  const {
    code,
    cpuTimeoutMs,
    memoryLimitMb,
    maxLogBytes,
    maxOutputBytes,
    port,
    quickjsModuleUrl,
    variantModuleUrl,
  } = workerData;

  const [quickjsMod, variantMod] = await Promise.all([
    import(quickjsModuleUrl),
    import(variantModuleUrl),
  ]);

  const variant = variantMod.default || variantMod;
  const QuickJS = await quickjsMod.newQuickJSWASMModuleFromVariant(variant);
  const runtime = QuickJS.newRuntime({
    memoryLimitBytes: memoryLimitMb * 1024 * 1024,
    maxStackSizeBytes: 512 * 1024,
  });

  let cumulativeCpuMs = 0;
  let sliceStart = 0;
  let cpuTimedOut = false;

  runtime.setInterruptHandler(() => {
    if (sliceStart > 0 && cumulativeCpuMs + (Date.now() - sliceStart) > cpuTimeoutMs) {
      cpuTimedOut = true;
      return true;
    }
    return false;
  });

  const vm = runtime.newContext();
  const logs = [];
  let logBytes = 0;
  let truncatedLogs = false;
  let nextRpcId = 1;
  const pendingRpcs = new Map();
  let settled = false;

  const formatLogArg = (val) => {
    if (typeof val === 'string') return val;
    try {
      const json = JSON.stringify(val);
      return json === undefined ? String(val) : json;
    } catch {
      return String(val);
    }
  };

  const pushLog = (level, args) => {
    const prefix = level === 'log' ? '' : '[' + level + '] ';
    const line = prefix + args.map(formatLogArg).join(' ');
    const bytes = Buffer.byteLength(line, 'utf8');
    if (logBytes + bytes > maxLogBytes) {
      truncatedLogs = true;
      return;
    }
    logBytes += bytes;
    logs.push(line);
  };

  const toQuickJsValue = (value) => {
    if (value === undefined) return vm.undefined;
    if (value === null) return vm.null;
    const serialized = JSON.stringify(value);
    if (serialized === undefined) return vm.undefined;
    const jsonGlobal = vm.getProp(vm.global, 'JSON');
    const parseFn = vm.getProp(jsonGlobal, 'parse');
    const strHandle = vm.newString(serialized);
    const parsed = vm.callFunction(parseFn, jsonGlobal, strHandle);
    strHandle.dispose();
    parseFn.dispose();
    jsonGlobal.dispose();
    if (parsed.error) {
      const errDump = vm.dump(parsed.error);
      parsed.error.dispose();
      throw new Error('Failed to pass value into sandbox: ' + String(errDump));
    }
    return parsed.value;
  };

  const classifyGuestError = (errObj) => {
    if (cpuTimedOut) {
      return { kind: 'cpu_timeout', message: 'Script exceeded CPU time limit (' + cpuTimeoutMs + 'ms)' };
    }
    const name = errObj && typeof errObj === 'object' && typeof errObj.name === 'string' ? errObj.name : '';
    const message =
      errObj && typeof errObj === 'object' && typeof errObj.message === 'string'
        ? errObj.message
        : String(errObj);

    if (/out of memory|memory limit/i.test(message) || name === 'InternalError' && /memory/i.test(message)) {
      return { kind: 'memory_limit', message: 'Script exceeded memory limit (' + memoryLimitMb + 'MB)' };
    }
    if (/interrupted/i.test(message)) {
      return { kind: 'cpu_timeout', message: 'Script exceeded CPU time limit (' + cpuTimeoutMs + 'ms)' };
    }
    if (name === 'SyntaxError') {
      return { kind: 'syntax_error', message: message || 'Syntax error in script' };
    }
    return { kind: 'runtime_error', message: message || 'Script execution failed' };
  };

  const pumpJobs = () => {
    while (!settled) {
      sliceStart = Date.now();
      const jobResult = runtime.executePendingJobs(50);
      cumulativeCpuMs += Date.now() - sliceStart;
      sliceStart = 0;

      if (jobResult.error) {
        const dumped = vm.dump(jobResult.error);
        jobResult.error.dispose();
        const classified = classifyGuestError(dumped);
        finishError(classified.kind, classified.message);
        return;
      }
      if (jobResult.value === 0) {
        break;
      }
    }
  };

  const cleanup = () => {
    for (const deferred of pendingRpcs.values()) {
      try {
        deferred.dispose();
      } catch {}
    }
    pendingRpcs.clear();
    try {
      vm.dispose();
    } catch {}
    try {
      runtime.dispose();
    } catch {}
    try {
      port.close();
    } catch {}
  };

  const finishOk = (value) => {
    if (settled) return;
    settled = true;
    try {
      const serialized = JSON.stringify(value === undefined ? null : value);
      if (serialized !== undefined && Buffer.byteLength(serialized, 'utf8') > maxOutputBytes) {
        port.postMessage({
          type: 'error',
          kind: 'output_too_large',
          message: 'Script return value exceeded maximum output size (' + maxOutputBytes + ' bytes)',
          logs,
          truncatedLogs,
        });
      } else {
        port.postMessage({
          type: 'result',
          value: value === undefined ? null : value,
          logs,
          truncatedLogs,
        });
      }
    } catch (err) {
      port.postMessage({
        type: 'error',
        kind: 'runtime_error',
        message: 'Script return value could not be serialized: ' + (err && err.message ? err.message : String(err)),
        logs,
        truncatedLogs,
      });
    } finally {
      cleanup();
    }
  };

  const finishError = (kind, message) => {
    if (settled) return;
    settled = true;
    port.postMessage({ type: 'error', kind, message, logs, truncatedLogs });
    cleanup();
  };

  // Install console.*
  const consoleObj = vm.newObject();
  for (const level of ['log', 'info', 'warn', 'error']) {
    const fn = vm.newFunction(level, (...argHandles) => {
      const dumpedArgs = argHandles.map((h) => vm.dump(h));
      pushLog(level, dumpedArgs);
    });
    vm.setProp(consoleObj, level, fn);
    fn.dispose();
  }
  vm.setProp(vm.global, 'console', consoleObj);
  consoleObj.dispose();

  // Install tools.search and tools.call
  const sendRpc = (method, payload) => {
    const rpcId = nextRpcId++;
    const deferred = vm.newPromise();
    pendingRpcs.set(rpcId, deferred);
    port.postMessage({ type: 'rpc', rpcId, method, payload });
    return deferred.handle;
  };

  const toolsObj = vm.newObject();
  const searchFn = vm.newFunction('search', (queryHandle, optionsHandle) => {
    const query = queryHandle ? vm.dump(queryHandle) : undefined;
    const options = optionsHandle ? vm.dump(optionsHandle) : undefined;
    return sendRpc('search', { query, options });
  });
  const callFn = vm.newFunction('call', (toolNameHandle, argsHandle) => {
    const toolName = toolNameHandle ? vm.dump(toolNameHandle) : undefined;
    const args = argsHandle ? vm.dump(argsHandle) : undefined;
    return sendRpc('call', { toolName, args });
  });
  vm.setProp(toolsObj, 'search', searchFn);
  vm.setProp(toolsObj, 'call', callFn);
  searchFn.dispose();
  callFn.dispose();
  vm.setProp(vm.global, 'tools', toolsObj);
  toolsObj.dispose();

  // Freeze tools & console so guest code cannot tamper with the host bridge
  const freezeRes = vm.evalCode('Object.freeze(globalThis.tools); Object.freeze(globalThis.console);');
  if (freezeRes.error) {
    freezeRes.error.dispose();
  } else {
    freezeRes.value.dispose();
  }

  // Handle RPC replies from main thread
  port.on('message', (msg) => {
    if (settled || !msg || msg.type !== 'rpc_reply') return;
    const deferred = pendingRpcs.get(msg.rpcId);
    if (!deferred) return;
    pendingRpcs.delete(msg.rpcId);

    try {
      if (msg.ok) {
        const valHandle = toQuickJsValue(msg.value);
        deferred.resolve(valHandle);
        if (valHandle !== vm.undefined && valHandle !== vm.null) {
          valHandle.dispose();
        }
      } else {
        const errHandle = vm.newError({
          name: msg.errorKind || 'Error',
          message: msg.errorMessage || 'Tool call failed',
        });
        deferred.reject(errHandle);
        errHandle.dispose();
      }
    } catch (err) {
      const classified = classifyGuestError(err);
      finishError(classified.kind, classified.message);
      return;
    }

    pumpJobs();
  });

  // Compile and invoke the async function body
  const wrappedSource = '(async () => {\\n' + code + '\\n})';
  sliceStart = Date.now();
  const compileResult = vm.evalCode(wrappedSource, 'code-mode.js');
  cumulativeCpuMs += Date.now() - sliceStart;
  sliceStart = 0;

  if (compileResult.error) {
    const dumped = vm.dump(compileResult.error);
    compileResult.error.dispose();
    const classified = classifyGuestError(dumped);
    finishError(classified.kind, classified.message);
    return;
  }

  const fnHandle = compileResult.value;
  sliceStart = Date.now();
  const callResult = vm.callFunction(fnHandle, vm.undefined);
  cumulativeCpuMs += Date.now() - sliceStart;
  sliceStart = 0;
  fnHandle.dispose();

  if (callResult.error) {
    const dumped = vm.dump(callResult.error);
    callResult.error.dispose();
    const classified = classifyGuestError(dumped);
    finishError(classified.kind, classified.message);
    return;
  }

  const promiseHandle = callResult.value;
  const hostPromise = vm.resolvePromise(promiseHandle);
  promiseHandle.dispose();

  hostPromise.then(
    (resolved) => {
      if (settled) {
        if (resolved.error) resolved.error.dispose();
        else resolved.value.dispose();
        return;
      }
      if (resolved.error) {
        const dumped = vm.dump(resolved.error);
        resolved.error.dispose();
        const classified = classifyGuestError(dumped);
        finishError(classified.kind, classified.message);
      } else {
        const dumped = vm.dump(resolved.value);
        resolved.value.dispose();
        finishOk(dumped);
      }
    },
    (err) => {
      const classified = classifyGuestError(err);
      finishError(classified.kind, classified.message);
    },
  );

  pumpJobs();
})().catch((err) => {
  try {
    workerData.port.postMessage({
      type: 'error',
      kind: 'runtime_error',
      message: err && err.message ? err.message : String(err),
      logs: [],
      truncatedLogs: false,
    });
  } catch {}
});
`;

interface WorkerRpcMessage {
  type: 'rpc';
  rpcId: number;
  method: 'search' | 'call';
  payload: Record<string, unknown>;
}

interface WorkerResultMessage {
  type: 'result';
  value: unknown;
  logs: string[];
  truncatedLogs: boolean;
}

interface WorkerErrorMessage {
  type: 'error';
  kind: CodeSandboxErrorKind;
  message: string;
  logs: string[];
  truncatedLogs: boolean;
}

type WorkerMessage = WorkerRpcMessage | WorkerResultMessage | WorkerErrorMessage;

export class QuickJsWorkerSandboxRunner implements CodeSandboxRunner {
  private activeRuns = 0;
  private readonly quickjsModuleUrl: string;
  private readonly variantModuleUrl: string;

  constructor() {
    this.quickjsModuleUrl = resolvePackageFileUrl('quickjs-emscripten');
    this.variantModuleUrl = resolvePackageFileUrl('@jitl/quickjs-ng-wasmfile-release-sync');
  }

  public async run(request: CodeSandboxRunRequest): Promise<CodeSandboxRunResult> {
    const { code, limits, bridge } = request;

    if (Buffer.byteLength(code, 'utf8') > limits.maxSourceBytes) {
      throw new CodeSandboxError(
        'source_too_large',
        `Script source exceeds maximum allowed size (${limits.maxSourceBytes} bytes)`,
      );
    }

    if (this.activeRuns >= limits.maxConcurrentRuns) {
      throw new CodeSandboxError(
        'concurrency_limit',
        `Too many concurrent code-mode executions (limit: ${limits.maxConcurrentRuns})`,
      );
    }

    this.activeRuns += 1;

    try {
      return await this.runInWorker(code, limits, bridge);
    } finally {
      this.activeRuns = Math.max(0, this.activeRuns - 1);
    }
  }

  private runInWorker(
    code: string,
    limits: CodeSandboxRunRequest['limits'],
    bridge: CodeSandboxRunRequest['bridge'],
  ): Promise<CodeSandboxRunResult> {
    return new Promise<CodeSandboxRunResult>((resolve, reject) => {
      const { port1: hostPort, port2: workerPort } = new MessageChannel();
      let settled = false;

      const worker = new Worker(WORKER_SOURCE, {
        eval: true,
        workerData: {
          code,
          cpuTimeoutMs: limits.cpuTimeoutMs,
          memoryLimitMb: limits.memoryLimitMb,
          maxLogBytes: limits.maxLogBytes,
          maxOutputBytes: limits.maxOutputBytes,
          port: workerPort,
          quickjsModuleUrl: this.quickjsModuleUrl,
          variantModuleUrl: this.variantModuleUrl,
        },
        transferList: [workerPort],
      });

      const finish = (fn: () => void) => {
        if (settled) return;
        settled = true;
        clearTimeout(wallTimer);
        hostPort.close();
        void worker.terminate();
        fn();
      };

      const wallTimer = setTimeout(() => {
        finish(() =>
          reject(
            new CodeSandboxError(
              'timeout',
              `Script execution timed out after ${limits.timeoutMs}ms`,
            ),
          ),
        );
      }, limits.timeoutMs);

      hostPort.on('message', (msg: WorkerMessage) => {
        if (settled || !msg) return;

        if (msg.type === 'rpc') {
          void (async () => {
            try {
              let value: unknown;
              if (msg.method === 'search') {
                const query = typeof msg.payload?.query === 'string' ? msg.payload.query : '';
                const rawOptions = msg.payload?.options;
                const options =
                  rawOptions && typeof rawOptions === 'object'
                    ? {
                        limit:
                          typeof (rawOptions as Record<string, unknown>).limit === 'number'
                            ? ((rawOptions as Record<string, unknown>).limit as number)
                            : undefined,
                      }
                    : undefined;
                value = await bridge.search(query, options);
              } else {
                const toolName =
                  typeof msg.payload?.toolName === 'string' ? msg.payload.toolName : '';
                const args =
                  msg.payload?.args && typeof msg.payload.args === 'object'
                    ? (msg.payload.args as Record<string, unknown>)
                    : undefined;
                value = await bridge.call(toolName, args);
              }
              if (!settled) {
                hostPort.postMessage({ type: 'rpc_reply', rpcId: msg.rpcId, ok: true, value });
              }
            } catch (err) {
              if (!settled) {
                const errorKind =
                  err instanceof CodeSandboxError ? err.kind : 'runtime_error';
                const errorMessage = err instanceof Error ? err.message : String(err);
                hostPort.postMessage({
                  type: 'rpc_reply',
                  rpcId: msg.rpcId,
                  ok: false,
                  errorKind,
                  errorMessage,
                });
              }
            }
          })();
          return;
        }

        if (msg.type === 'result') {
          finish(() =>
            resolve({
              value: msg.value,
              logs: msg.logs,
              truncatedLogs: msg.truncatedLogs,
            }),
          );
          return;
        }

        if (msg.type === 'error') {
          finish(() => reject(new CodeSandboxError(msg.kind, msg.message)));
        }
      });

      worker.on('error', (err) => {
        finish(() =>
          reject(
            new CodeSandboxError(
              'runtime_error',
              `Sandbox worker error: ${err instanceof Error ? err.message : String(err)}`,
            ),
          ),
        );
      });

      worker.on('exit', (exitCode) => {
        if (!settled) {
          finish(() =>
            reject(
              new CodeSandboxError(
                'runtime_error',
                `Sandbox worker exited unexpectedly with code ${exitCode}`,
              ),
            ),
          );
        }
      });
    });
  }
}

let defaultRunner: CodeSandboxRunner | undefined;

export const getDefaultCodeSandboxRunner = (): CodeSandboxRunner => {
  defaultRunner ??= new QuickJsWorkerSandboxRunner();
  return defaultRunner;
};
