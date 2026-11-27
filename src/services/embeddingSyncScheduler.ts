import type { Tool } from '../types/index.js';
import { logger } from '../utils/logger.js';
import { summarizeErrorForLogging } from '../utils/serialization.js';
import * as vectorSearchService from './vectorSearchService.js';

export interface ServerSyncOptions {
  reportProgress?: boolean;
  partial?: boolean;
  /**
   * Keep this sync queued across routine generation bumps (e.g., personal-
   * credential partial syncs that a global full resync cannot rediscover).
   * Defaults to `true` when `partial` is `true`.
   */
  preserveAcrossGeneration?: boolean;
}

export interface BumpGenerationOptions {
  /**
   * Drop all queued syncs/removals/resyncs (used by a full index clear where
   * the caller rebuilds every server — including personal-credential servers —
   * from scratch).
   */
  clearAll?: boolean;
}

export type PrepareToolsFn = (serverName: string, tools: Tool[]) => Promise<Tool[]>;

export interface RequestFullResyncOptions {
  /**
   * Bump the scheduler generation counter so queued sync jobs created before a
   * provider/model/dimension/config change are invalidated as stale.
   */
  bumpGeneration?: boolean;
}

export interface EmbeddingSyncExecutor {
  saveServerTools: (
    serverName: string,
    tools: Tool[],
    options?: ServerSyncOptions,
  ) => Promise<void>;
  removeServerEmbeddings: (serverName: string) => Promise<void>;
  removeToolEmbeddings: (serverName: string, toolNames: string[]) => Promise<void>;
  syncAllServerTools: () => Promise<void>;
  invalidateServerBatches?: (serverName: string) => void;
}

export type SchedulerJobType =
  | 'server-sync'
  | 'single-tool-sync'
  | 'tool-removal'
  | 'server-cleanup'
  | 'full-resync'
  | 'index-clear';

interface JobWaiter {
  resolve: () => void;
  reject: (error: unknown) => void;
}

interface BaseJob {
  id: number;
  type: SchedulerJobType;
  generation: number;
  waiters: JobWaiter[];
}

interface ServerSyncJob extends BaseJob {
  type: 'server-sync';
  serverName: string;
  tools: Tool[];
  options: ServerSyncOptions;
  preserveAcrossGeneration: boolean;
  prepareTools?: PrepareToolsFn;
}

interface SingleToolSyncJob extends BaseJob {
  type: 'single-tool-sync';
  serverName: string;
  tool: Tool;
  prepareTools?: PrepareToolsFn;
}

interface ToolRemovalJob extends BaseJob {
  type: 'tool-removal';
  serverName: string;
  toolNames: string[];
}

interface ServerCleanupJob extends BaseJob {
  type: 'server-cleanup';
  serverName: string;
}

interface FullResyncJob extends BaseJob {
  type: 'full-resync';
  reason: string;
}

interface IndexClearJob extends BaseJob {
  type: 'index-clear';
  reason: string;
  clearFn: () => Promise<void>;
}

type SchedulerJob =
  | ServerSyncJob
  | SingleToolSyncJob
  | ToolRemovalJob
  | ServerCleanupJob
  | FullResyncJob
  | IndexClearJob;

export interface EmbeddingSyncSchedulerState {
  activeJob: {
    id: number;
    type: SchedulerJobType;
    serverName?: string;
    generation: number;
  } | null;
  queueLength: number;
  generation: number;
  isIdle: boolean;
}

const defaultExecutor: EmbeddingSyncExecutor = {
  saveServerTools: (serverName, tools, options) =>
    vectorSearchService.saveToolsAsVectorEmbeddings(serverName, tools, options),
  removeServerEmbeddings: (serverName) =>
    vectorSearchService.removeServerToolEmbeddings(serverName),
  removeToolEmbeddings: (serverName, toolNames) =>
    vectorSearchService.removeToolEmbeddings(serverName, toolNames),
  syncAllServerTools: () => vectorSearchService.syncAllServerToolsEmbeddings(),
  invalidateServerBatches: (serverName) => {
    if (typeof vectorSearchService.invalidateEmbeddingBatches === 'function') {
      vectorSearchService.invalidateEmbeddingBatches(serverName);
    }
  },
};

const mergeToolByName = (existing: Tool[], incoming: Tool[]): Tool[] => {
  const byName = new Map<string, Tool>();
  for (const tool of existing) {
    byName.set(tool.name, tool);
  }
  for (const tool of incoming) {
    byName.set(tool.name, tool);
  }
  return [...byName.values()];
};

const resolveWaiters = (waiters: JobWaiter[]): void => {
  for (const waiter of waiters) {
    waiter.resolve();
  }
};

const rejectWaiters = (waiters: JobWaiter[], error: unknown): void => {
  for (const waiter of waiters) {
    waiter.reject(error);
  }
};

const createDeferred = (): { promise: Promise<void>; waiter: JobWaiter } => {
  let resolve!: () => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<void>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, waiter: { resolve, reject } };
};

/**
 * Centralized in-process scheduler for all background embedding mutations.
 *
 * Invariants:
 * - Strictly one embedding mutation job executes at a time across the process.
 * - Real embedding provider API calls continue to pass through the provider
 *   queue (`withEmbeddingQueue` in `vectorSearchService.ts`) as the final barrier.
 * - Pending server syncs are deduplicated; single-tool syncs coalesce into a
 *   pending full server sync when applicable.
 * - Repeated full resync requests coalesce into a single execution.
 * - Server cleanup supersedes pending sync/tool-removal work for the same server
 *   and immediately invalidates any in-flight batch for that server.
 * - Generation bumps invalidate stale queued sync jobs after provider/model/
 *   dimension/config changes without dropping cleanup jobs.
 */
export class EmbeddingSyncScheduler {
  private readonly executor: EmbeddingSyncExecutor;
  private queue: SchedulerJob[] = [];
  private activeJob: SchedulerJob | null = null;
  private draining = false;
  private generation = 0;
  private nextJobId = 1;
  private idleWaiters: Array<() => void> = [];

  constructor(executor: EmbeddingSyncExecutor = defaultExecutor) {
    this.executor = executor;
  }

  getGeneration(): number {
    return this.generation;
  }

  getState(): EmbeddingSyncSchedulerState {
    return {
      activeJob: this.activeJob
        ? {
            id: this.activeJob.id,
            type: this.activeJob.type,
            ...('serverName' in this.activeJob ? { serverName: this.activeJob.serverName } : {}),
            generation: this.activeJob.generation,
          }
        : null,
      queueLength: this.queue.length,
      generation: this.generation,
      isIdle: this.activeJob === null && this.queue.length === 0 && !this.draining,
    };
  }

  /**
   * Increment the generation counter and drop stale queued sync jobs that were
   * scheduled under an older embedding configuration/dimension.
   *
   * Unless `clearAll` is set (for a full index wipe + rebuild), preserves:
   * - `server-cleanup` and `tool-removal` jobs (disabled/deleted servers/tools
   *   must still be cleaned up; global full resync skips disconnected servers)
   * - `server-sync` jobs marked `preserveAcrossGeneration` (personal-credential
   *   partial snapshots that global full resync cannot rediscover)
   * - pending `full-resync` jobs (so callers awaiting an already-queued resync
   *   share the coalesced execution at the new generation instead of resolving
   *   early)
   */
  bumpGeneration(reason: string, options?: BumpGenerationOptions): number {
    const clearAll = options?.clearAll === true;
    this.generation += 1;
    const currentGeneration = this.generation;
    const retained: SchedulerJob[] = [];

    for (const job of this.queue) {
      if (job.type === 'server-cleanup' || job.type === 'index-clear') {
        retained.push(job);
        continue;
      }

      if (!clearAll) {
        if (
          job.type === 'tool-removal' ||
          job.type === 'full-resync' ||
          (job.type === 'server-sync' && job.preserveAcrossGeneration)
        ) {
          job.generation = currentGeneration;
          retained.push(job);
          continue;
        }
      }

      if (job.generation < currentGeneration) {
        logger.log('[EmbeddingScheduler] superseded', {
          event: 'superseded',
          jobId: job.id,
          type: job.type,
          ...('serverName' in job ? { serverName: job.serverName } : {}),
          reason: `generation-changed:${reason}`,
          jobGeneration: job.generation,
          generation: currentGeneration,
        });
        resolveWaiters(job.waiters);
        continue;
      }

      retained.push(job);
    }

    this.queue = retained;
    return currentGeneration;
  }

  enqueueServerSync(
    serverName: string,
    tools: Tool[],
    options?: ServerSyncOptions,
    prepareTools?: PrepareToolsFn,
  ): Promise<void> {
    const { promise, waiter } = createDeferred();
    const isPartial = options?.partial === true;
    const preserveAcrossGeneration = options?.preserveAcrossGeneration ?? isPartial;
    const saveOptions: ServerSyncOptions = {};
    if (options?.reportProgress !== undefined) {
      saveOptions.reportProgress = options.reportProgress;
    }
    if (options?.partial !== undefined) {
      saveOptions.partial = options.partial;
    }

    // Scan backwards from the tail for this server, stopping at any barrier
    // (server-cleanup, tool-removal, full-resync, or index-clear) so causal
    // ordering holds.
    for (let i = this.queue.length - 1; i >= 0; i--) {
      const candidate = this.queue[i];
      if (candidate.type === 'full-resync' || candidate.type === 'index-clear') break;
      if (!('serverName' in candidate) || candidate.serverName !== serverName) continue;
      if (candidate.type === 'server-cleanup' || candidate.type === 'tool-removal') break;

      // For a partial sync, stop before any single-tool sync so we never merge
      // a newer partial snapshot behind a pending single-tool update; the
      // absorption pass below merges those single-tool updates in order.
      if (isPartial && candidate.type === 'single-tool-sync') break;

      if (candidate.type === 'server-sync') {
        if (!isPartial && candidate.options.partial !== true) {
          // Deduplicate full server sync: keep the latest snapshot.
          candidate.tools = [...tools];
          candidate.options = {
            ...candidate.options,
            ...saveOptions,
            ...(candidate.options.reportProgress || saveOptions.reportProgress
              ? { reportProgress: true }
              : {}),
          };
          candidate.preserveAcrossGeneration =
            candidate.preserveAcrossGeneration || preserveAcrossGeneration;
          candidate.prepareTools = prepareTools ?? candidate.prepareTools;
          candidate.generation = this.generation;
          candidate.waiters.push(waiter);
          logger.log('[EmbeddingScheduler] merge', {
            event: 'merge',
            jobId: candidate.id,
            type: candidate.type,
            incomingType: 'server-sync',
            serverName,
            partial: false,
            generation: this.generation,
          });
          this.scheduleDrain();
          return promise;
        }

        if (isPartial && candidate.options.partial !== true) {
          // A full server sync is already pending; coalesce this partial update into it.
          candidate.tools = mergeToolByName(candidate.tools, tools);
          if (saveOptions.reportProgress) {
            candidate.options.reportProgress = true;
          }
          candidate.preserveAcrossGeneration =
            candidate.preserveAcrossGeneration || preserveAcrossGeneration;
          candidate.waiters.push(waiter);
          logger.log('[EmbeddingScheduler] merge', {
            event: 'merge',
            jobId: candidate.id,
            type: candidate.type,
            incomingType: 'server-sync-partial',
            serverName,
            partial: true,
            generation: this.generation,
          });
          this.scheduleDrain();
          return promise;
        }

        if (isPartial && candidate.options.partial === true) {
          // Coalesce back-to-back partial syncs for the same server.
          candidate.tools = mergeToolByName(candidate.tools, tools);
          if (saveOptions.reportProgress) {
            candidate.options.reportProgress = true;
          }
          candidate.preserveAcrossGeneration =
            candidate.preserveAcrossGeneration || preserveAcrossGeneration;
          candidate.prepareTools = prepareTools ?? candidate.prepareTools;
          candidate.generation = this.generation;
          candidate.waiters.push(waiter);
          logger.log('[EmbeddingScheduler] merge', {
            event: 'merge',
            jobId: candidate.id,
            type: candidate.type,
            incomingType: 'server-sync-partial',
            serverName,
            partial: true,
            generation: this.generation,
          });
          this.scheduleDrain();
          return promise;
        }
      }
    }

    // Find the latest causal barrier for this server.
    let barrierIndex = -1;
    for (let i = this.queue.length - 1; i >= 0; i--) {
      const candidate = this.queue[i];
      if (
        candidate.type === 'full-resync' ||
        candidate.type === 'index-clear' ||
        ('serverName' in candidate &&
          candidate.serverName === serverName &&
          (candidate.type === 'server-cleanup' || candidate.type === 'tool-removal'))
      ) {
        barrierIndex = i;
        break;
      }
    }

    const inheritedWaiters: JobWaiter[] = [];
    let mergedTools: Tool[] = [...tools];

    if (!isPartial) {
      // A full server sync supersedes any pending single-tool or partial server
      // syncs for the same server queued after the latest barrier.
      const nextQueue: SchedulerJob[] = [];
      for (let i = 0; i < this.queue.length; i++) {
        const candidate = this.queue[i];
        if (
          i > barrierIndex &&
          'serverName' in candidate &&
          candidate.serverName === serverName &&
          (candidate.type === 'single-tool-sync' ||
            (candidate.type === 'server-sync' && candidate.options.partial === true))
        ) {
          logger.log('[EmbeddingScheduler] superseded', {
            event: 'superseded',
            jobId: candidate.id,
            type: candidate.type,
            serverName,
            reason: 'full-server-sync',
            generation: this.generation,
          });
          inheritedWaiters.push(...candidate.waiters);
          continue;
        }
        nextQueue.push(candidate);
      }
      this.queue = nextQueue;
    } else {
      // Absorb pending single-tool syncs (and any earlier partial syncs) for
      // this server after the latest barrier into this partial sync in causal
      // order so newer snapshots always overwrite older ones.
      const priorTools: Tool[] = [];
      let inheritedReportProgress = saveOptions.reportProgress === true;
      const nextQueue: SchedulerJob[] = [];
      for (let i = 0; i < this.queue.length; i++) {
        const candidate = this.queue[i];
        if (
          i > barrierIndex &&
          'serverName' in candidate &&
          candidate.serverName === serverName &&
          (candidate.type === 'single-tool-sync' ||
            (candidate.type === 'server-sync' && candidate.options.partial === true))
        ) {
          if (candidate.type === 'single-tool-sync') {
            priorTools.push(candidate.tool);
          } else {
            priorTools.push(...candidate.tools);
            if (candidate.options.reportProgress) {
              inheritedReportProgress = true;
            }
          }
          logger.log('[EmbeddingScheduler] merge', {
            event: 'merge',
            jobId: candidate.id,
            type: candidate.type,
            incomingType: 'server-sync-partial',
            serverName,
            partial: true,
            generation: this.generation,
          });
          inheritedWaiters.push(...candidate.waiters);
          continue;
        }
        nextQueue.push(candidate);
      }
      this.queue = nextQueue;
      if (priorTools.length > 0) {
        mergedTools = mergeToolByName(priorTools, tools);
      }
      if (inheritedReportProgress) {
        saveOptions.reportProgress = true;
      }
    }

    inheritedWaiters.push(waiter);

    const job: ServerSyncJob = {
      id: this.nextJobId++,
      type: 'server-sync',
      serverName,
      tools: mergedTools,
      options: saveOptions,
      preserveAcrossGeneration,
      prepareTools,
      generation: this.generation,
      waiters: inheritedWaiters,
    };
    this.queue.push(job);
    logger.log('[EmbeddingScheduler] enqueue', {
      event: 'enqueue',
      jobId: job.id,
      type: job.type,
      serverName,
      toolCount: mergedTools.length,
      partial: isPartial,
      generation: job.generation,
      queueLength: this.queue.length,
    });
    this.scheduleDrain();
    return promise;
  }

  enqueueSingleToolSync(
    serverName: string,
    tool: Tool,
    prepareTools?: PrepareToolsFn,
  ): Promise<void> {
    const { promise, waiter } = createDeferred();

    // Coalesce into a pending server sync (full OR partial) or deduplicate
    // against an existing pending single-tool sync for the same
    // (serverName, tool.name) after the latest barrier.
    for (let i = this.queue.length - 1; i >= 0; i--) {
      const candidate = this.queue[i];
      if (candidate.type === 'full-resync' || candidate.type === 'index-clear') break;
      if (!('serverName' in candidate) || candidate.serverName !== serverName) continue;
      if (candidate.type === 'server-cleanup' || candidate.type === 'tool-removal') break;

      if (candidate.type === 'server-sync') {
        candidate.tools = mergeToolByName(candidate.tools, [tool]);
        candidate.generation = this.generation;
        candidate.waiters.push(waiter);
        logger.log('[EmbeddingScheduler] merge', {
          event: 'merge',
          jobId: candidate.id,
          type: candidate.type,
          incomingType: 'single-tool-sync',
          serverName,
          toolName: tool.name,
          partial: candidate.options.partial === true,
          generation: this.generation,
        });
        this.scheduleDrain();
        return promise;
      }

      if (candidate.type === 'single-tool-sync' && candidate.tool.name === tool.name) {
        candidate.tool = tool;
        candidate.prepareTools = prepareTools ?? candidate.prepareTools;
        candidate.generation = this.generation;
        candidate.waiters.push(waiter);
        logger.log('[EmbeddingScheduler] merge', {
          event: 'merge',
          jobId: candidate.id,
          type: candidate.type,
          incomingType: 'single-tool-sync',
          serverName,
          toolName: tool.name,
          generation: this.generation,
        });
        this.scheduleDrain();
        return promise;
      }
    }

    const job: SingleToolSyncJob = {
      id: this.nextJobId++,
      type: 'single-tool-sync',
      serverName,
      tool,
      prepareTools,
      generation: this.generation,
      waiters: [waiter],
    };
    this.queue.push(job);
    logger.log('[EmbeddingScheduler] enqueue', {
      event: 'enqueue',
      jobId: job.id,
      type: job.type,
      serverName,
      toolName: tool.name,
      generation: job.generation,
      queueLength: this.queue.length,
    });
    this.scheduleDrain();
    return promise;
  }

  enqueueToolRemoval(serverName: string, toolNames: string[]): Promise<void> {
    if (toolNames.length === 0) {
      return Promise.resolve();
    }

    const { promise, waiter } = createDeferred();
    const job: ToolRemovalJob = {
      id: this.nextJobId++,
      type: 'tool-removal',
      serverName,
      toolNames: [...new Set(toolNames)],
      generation: this.generation,
      waiters: [waiter],
    };
    this.queue.push(job);
    logger.log('[EmbeddingScheduler] enqueue', {
      event: 'enqueue',
      jobId: job.id,
      type: job.type,
      serverName,
      toolCount: job.toolNames.length,
      generation: job.generation,
      queueLength: this.queue.length,
    });
    this.scheduleDrain();
    return promise;
  }

  enqueueServerCleanup(serverName: string): Promise<void> {
    const { promise, waiter } = createDeferred();

    // Immediately invalidate any in-flight generation batch for this server so
    // it cannot persist stale rows after cleanup is requested.
    this.executor.invalidateServerBatches?.(serverName);

    // Cleanup wins: cancel all pending sync and tool-removal jobs for this server.
    let supersededCount = 0;
    const retained: SchedulerJob[] = [];
    for (const candidate of this.queue) {
      if (
        'serverName' in candidate &&
        candidate.serverName === serverName &&
        candidate.type !== 'server-cleanup'
      ) {
        supersededCount += 1;
        logger.log('[EmbeddingScheduler] superseded', {
          event: 'superseded',
          jobId: candidate.id,
          type: candidate.type,
          serverName,
          reason: 'server-cleanup',
          generation: this.generation,
        });
        resolveWaiters(candidate.waiters);
        continue;
      }
      retained.push(candidate);
    }
    this.queue = retained;

    if (supersededCount > 0) {
      logger.log('[EmbeddingScheduler] cleanup-wins', {
        event: 'cleanup-wins',
        serverName,
        supersededCount,
        generation: this.generation,
      });
    }

    // Deduplicate against an already-pending cleanup for this server.
    const existingCleanup = this.queue.find(
      (job): job is ServerCleanupJob =>
        job.type === 'server-cleanup' && job.serverName === serverName,
    );
    if (existingCleanup) {
      existingCleanup.waiters.push(waiter);
      logger.log('[EmbeddingScheduler] merge', {
        event: 'merge',
        jobId: existingCleanup.id,
        type: existingCleanup.type,
        incomingType: 'server-cleanup',
        serverName,
        generation: this.generation,
      });
      this.scheduleDrain();
      return promise;
    }

    const job: ServerCleanupJob = {
      id: this.nextJobId++,
      type: 'server-cleanup',
      serverName,
      generation: this.generation,
      waiters: [waiter],
    };
    this.queue.push(job);
    logger.log('[EmbeddingScheduler] enqueue', {
      event: 'enqueue',
      jobId: job.id,
      type: job.type,
      serverName,
      generation: job.generation,
      queueLength: this.queue.length,
    });
    this.scheduleDrain();
    return promise;
  }

  requestFullResync(reason: string, options?: RequestFullResyncOptions): Promise<void> {
    const bump = options?.bumpGeneration === true;
    const { promise, waiter } = createDeferred();

    if (bump) {
      this.bumpGeneration(reason);
    }

    logger.log('[EmbeddingScheduler] full-resync-requested', {
      event: 'full-resync-requested',
      reason,
      generation: this.generation,
      bumpGeneration: bump,
    });

    // Coalesce into an already-pending full resync in the queue.
    const pendingResync = this.queue.find(
      (job): job is FullResyncJob => job.type === 'full-resync',
    );
    if (pendingResync) {
      pendingResync.reason = reason;
      pendingResync.generation = this.generation;
      pendingResync.waiters.push(waiter);
      logger.log('[EmbeddingScheduler] full-resync-coalesced', {
        event: 'full-resync-coalesced',
        jobId: pendingResync.id,
        reason,
        target: 'pending',
        generation: this.generation,
      });
      this.scheduleDrain();
      return promise;
    }

    // If a full resync is already running for the current generation and this
    // request did not bump the generation, coalesce into the active run so
    // repeated triggers produce one real execution.
    if (!bump && this.activeJob?.type === 'full-resync' && this.activeJob.generation === this.generation) {
      this.activeJob.waiters.push(waiter);
      logger.log('[EmbeddingScheduler] full-resync-coalesced', {
        event: 'full-resync-coalesced',
        jobId: this.activeJob.id,
        reason,
        target: 'active',
        generation: this.generation,
      });
      return promise;
    }

    const job: FullResyncJob = {
      id: this.nextJobId++,
      type: 'full-resync',
      reason,
      generation: this.generation,
      waiters: [waiter],
    };
    this.queue.push(job);
    logger.log('[EmbeddingScheduler] enqueue', {
      event: 'enqueue',
      jobId: job.id,
      type: job.type,
      reason,
      generation: job.generation,
      queueLength: this.queue.length,
    });
    this.scheduleDrain();
    return promise;
  }

  enqueueIndexClear(reason: string, clearFn: () => Promise<void>): Promise<void> {
    const { promise, waiter } = createDeferred();

    // Supersede all pre-clear queued syncs/removals/resyncs before scheduling
    // the exclusive clear mutation.
    this.bumpGeneration(reason, { clearAll: true });

    const job: IndexClearJob = {
      id: this.nextJobId++,
      type: 'index-clear',
      reason,
      clearFn,
      generation: this.generation,
      waiters: [waiter],
    };
    this.queue.push(job);
    logger.log('[EmbeddingScheduler] enqueue', {
      event: 'enqueue',
      jobId: job.id,
      type: job.type,
      reason,
      generation: job.generation,
      queueLength: this.queue.length,
    });
    this.scheduleDrain();
    return promise;
  }

  waitForIdle(): Promise<void> {
    if (this.activeJob === null && this.queue.length === 0 && !this.draining) {
      return Promise.resolve();
    }
    return new Promise<void>((resolve) => {
      this.idleWaiters.push(resolve);
    });
  }

  private scheduleDrain(): void {
    if (this.draining) {
      return;
    }
    this.draining = true;
    void this.drain();
  }

  private async drain(): Promise<void> {
    try {
      while (this.queue.length > 0) {
        const job = this.queue.shift()!;

        // Skip stale non-cleanup jobs whose generation was superseded while waiting.
        if (
          job.type !== 'server-cleanup' &&
          job.type !== 'tool-removal' &&
          job.type !== 'index-clear' &&
          job.generation < this.generation
        ) {
          logger.log('[EmbeddingScheduler] superseded', {
            event: 'superseded',
            jobId: job.id,
            type: job.type,
            ...('serverName' in job ? { serverName: job.serverName } : {}),
            reason: 'stale-generation',
            jobGeneration: job.generation,
            generation: this.generation,
          });
          resolveWaiters(job.waiters);
          continue;
        }

        this.activeJob = job;
        const startedAt = Date.now();
        logger.log('[EmbeddingScheduler] start', {
          event: 'start',
          jobId: job.id,
          type: job.type,
          ...('serverName' in job ? { serverName: job.serverName } : {}),
          ...(job.type === 'full-resync' ? { reason: job.reason } : {}),
          generation: job.generation,
        });

        try {
          await this.executeJob(job);
          logger.log('[EmbeddingScheduler] finish', {
            event: 'finish',
            jobId: job.id,
            type: job.type,
            ...('serverName' in job ? { serverName: job.serverName } : {}),
            generation: job.generation,
            durationMs: Date.now() - startedAt,
          });
          resolveWaiters(job.waiters);
        } catch (error) {
          logger.warn('[EMBED_SYNC_ERROR] [EmbeddingScheduler] fail', {
            event: 'fail',
            jobId: job.id,
            type: job.type,
            ...('serverName' in job ? { serverName: job.serverName } : {}),
            generation: job.generation,
            durationMs: Date.now() - startedAt,
            error: summarizeErrorForLogging(error),
          });
          rejectWaiters(job.waiters, error);
        } finally {
          this.activeJob = null;
        }
      }
    } finally {
      this.draining = false;
      if (this.queue.length > 0) {
        this.scheduleDrain();
      } else {
        const waiters = this.idleWaiters;
        this.idleWaiters = [];
        for (const resolve of waiters) {
          resolve();
        }
      }
    }
  }

  private async executeJob(job: SchedulerJob): Promise<void> {
    switch (job.type) {
      case 'server-sync': {
        const preparedTools = job.prepareTools
          ? await job.prepareTools(job.serverName, job.tools)
          : job.tools;
        if (preparedTools.length === 0) {
          if (job.options.partial) {
            return;
          }
          await this.executor.removeServerEmbeddings(job.serverName);
          return;
        }
        const saveOptions = Object.keys(job.options).length > 0 ? job.options : undefined;
        await this.executor.saveServerTools(job.serverName, preparedTools, saveOptions);
        return;
      }

      case 'single-tool-sync': {
        const preparedTools = job.prepareTools
          ? await job.prepareTools(job.serverName, [job.tool])
          : [job.tool];
        if (preparedTools.length === 0) {
          return;
        }
        await this.executor.saveServerTools(job.serverName, preparedTools, { partial: true });
        return;
      }

      case 'tool-removal': {
        await this.executor.removeToolEmbeddings(job.serverName, job.toolNames);
        return;
      }

      case 'server-cleanup': {
        await this.executor.removeServerEmbeddings(job.serverName);
        return;
      }

      case 'full-resync': {
        await this.executor.syncAllServerTools();
        return;
      }

      case 'index-clear': {
        await job.clearFn();
        return;
      }
    }
  }
}

export const embeddingSyncScheduler = new EmbeddingSyncScheduler();

export const enqueueServerSync = (
  serverName: string,
  tools: Tool[],
  options?: ServerSyncOptions,
  prepareTools?: PrepareToolsFn,
): Promise<void> => embeddingSyncScheduler.enqueueServerSync(serverName, tools, options, prepareTools);

export const enqueueSingleToolSync = (
  serverName: string,
  tool: Tool,
  prepareTools?: PrepareToolsFn,
): Promise<void> => embeddingSyncScheduler.enqueueSingleToolSync(serverName, tool, prepareTools);

export const enqueueToolRemoval = (serverName: string, toolNames: string[]): Promise<void> =>
  embeddingSyncScheduler.enqueueToolRemoval(serverName, toolNames);

export const enqueueServerCleanup = (serverName: string): Promise<void> =>
  embeddingSyncScheduler.enqueueServerCleanup(serverName);

export const requestFullResync = (
  reason: string,
  options?: RequestFullResyncOptions,
): Promise<void> => embeddingSyncScheduler.requestFullResync(reason, options);

export const bumpEmbeddingGeneration = (
  reason: string,
  options?: BumpGenerationOptions,
): number => embeddingSyncScheduler.bumpGeneration(reason, options);

export const enqueueIndexClear = (
  reason: string,
  clearFn: () => Promise<void>,
): Promise<void> => embeddingSyncScheduler.enqueueIndexClear(reason, clearFn);

export const waitForIdle = (): Promise<void> => embeddingSyncScheduler.waitForIdle();

// Register the centralized scheduler as the full-resync handler for vectorSearchService
// (e.g. when database vector dimensions are reset) without introducing a circular import.
if (typeof vectorSearchService.registerFullResyncRequester === 'function') {
  vectorSearchService.registerFullResyncRequester((reason) => {
    void requestFullResync(reason, { bumpGeneration: true }).catch((error) => {
      logger.error('[EMBED_SYNC_ERROR] Full embeddings resync failed', { reason, error });
    });
  });
}
