import { PgBoss, type ConstructorOptions, type SendOptions, type WorkOptions } from 'pg-boss';

import {
  createTenantJobEnvelope,
  withTenantContext,
  type TenantJobEnvelope,
  type TenantJobHandler,
  type TenantJobRequest,
  type TenantQueueJob,
} from './with-tenant-context.js';

export {
  MissingTenantContextError,
  type TenantJobEnvelope,
  type TenantJobHandler,
  type TenantJobHandlerInput,
  type TenantJobRequest,
  type TenantQueueJob,
} from './with-tenant-context.js';

export type TenantQueueJobOptions = SendOptions;
export type TenantQueueWorkOptions = WorkOptions;

export const DEFAULT_TENANT_JOB_OPTIONS = {
  retryLimit: 3,
  retryDelay: 30,
  retryBackoff: true,
} satisfies TenantQueueJobOptions;

export interface TenantQueueBoss {
  send(
    name: string,
    data: TenantJobEnvelope,
    options?: TenantQueueJobOptions,
  ): Promise<string | null>;
  work(
    name: string,
    options: TenantQueueWorkOptions,
    handler: (job: TenantQueueJob) => Promise<unknown>,
  ): Promise<string>;
}

export interface CreateTenantQueueOptions {
  defaultJobOptions?: TenantQueueJobOptions;
  defaultWorkOptions?: TenantQueueWorkOptions;
}

export interface TenantQueue {
  enqueue<TPayload>(
    name: string,
    request: TenantJobRequest<TPayload>,
    options?: TenantQueueJobOptions,
  ): Promise<string | null>;
  work<TPayload, TResult = void>(
    name: string,
    handler: TenantJobHandler<TPayload, TResult>,
    options?: TenantQueueWorkOptions,
  ): Promise<string>;
}

export class PgBossTenantQueueBoss implements TenantQueueBoss {
  constructor(private readonly boss: PgBoss) {}

  async send(
    name: string,
    data: TenantJobEnvelope,
    options?: TenantQueueJobOptions,
  ): Promise<string | null> {
    return this.boss.send(name, data, options);
  }

  async work(
    name: string,
    options: TenantQueueWorkOptions,
    handler: (job: TenantQueueJob) => Promise<unknown>,
  ): Promise<string> {
    return this.boss.work<TenantJobEnvelope, void>(name, options, async (jobs) => {
      for (const job of jobs) {
        await handler({ id: job.id, data: job.data });
      }
    });
  }
}

export function createTenantQueue(
  boss: TenantQueueBoss,
  options: CreateTenantQueueOptions = {},
): TenantQueue {
  const defaultJobOptions = {
    ...DEFAULT_TENANT_JOB_OPTIONS,
    ...options.defaultJobOptions,
  } satisfies TenantQueueJobOptions;
  const defaultWorkOptions = options.defaultWorkOptions ?? {};

  return {
    enqueue: async <TPayload>(
      name: string,
      request: TenantJobRequest<TPayload>,
      jobOptions: TenantQueueJobOptions = {},
    ) => {
      const data = createTenantJobEnvelope(request);

      return boss.send(name, data, { ...defaultJobOptions, ...jobOptions });
    },
    work: async <TPayload, TResult = void>(
      name: string,
      handler: TenantJobHandler<TPayload, TResult>,
      workOptions: TenantQueueWorkOptions = {},
    ) => boss.work(name, { ...defaultWorkOptions, ...workOptions }, withTenantContext(handler)),
  };
}

export interface PgBossTenantQueue {
  boss: PgBoss;
  queue: TenantQueue;
}

export function createPgBossTenantQueue(
  connection: string | ConstructorOptions,
  options?: CreateTenantQueueOptions,
): PgBossTenantQueue {
  const boss = typeof connection === 'string' ? new PgBoss(connection) : new PgBoss(connection);

  return {
    boss,
    queue: createTenantQueue(new PgBossTenantQueueBoss(boss), options),
  };
}
