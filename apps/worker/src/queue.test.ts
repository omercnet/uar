import type { TenantContext } from '@uar/core';
import { describe, expect, it } from 'vitest';

import {
  createTenantQueue,
  MissingTenantContextError,
  type TenantJobEnvelope,
  type TenantJobRequest,
  type TenantQueueBoss,
  type TenantQueueJob,
  type TenantQueueJobOptions,
  type TenantQueueWorkOptions,
} from './queue.js';

type StoredHandler = (job: TenantQueueJob) => Promise<unknown>;

class FakeBoss implements TenantQueueBoss {
  readonly sent: Array<{
    name: string;
    data: TenantJobEnvelope;
    options: TenantQueueJobOptions | undefined;
  }> = [];

  private readonly handlers = new Map<
    string,
    { options: TenantQueueWorkOptions; handler: StoredHandler }
  >();

  async send(
    name: string,
    data: TenantJobEnvelope,
    options?: TenantQueueJobOptions,
  ): Promise<string | null> {
    this.sent.push({ name, data, options });

    return `job-${this.sent.length}`;
  }

  async work(
    name: string,
    options: TenantQueueWorkOptions,
    handler: StoredHandler,
  ): Promise<string> {
    this.handlers.set(name, { options, handler });

    return `worker-${name}`;
  }

  async run(name: string, job: TenantQueueJob): Promise<unknown> {
    const registered = this.handlers.get(name);

    if (registered === undefined) {
      throw new Error(`No handler registered for ${name}`);
    }

    return registered.handler(job);
  }
}

const tenantContext = {
  tenantId: 'tenant_acme',
  userId: 'user_ada',
  roles: ['admin'],
} satisfies TenantContext;

describe('tenant pg_boss queue', () => {
  it('enqueues and handles a job with tenant context', async () => {
    const boss = new FakeBoss();
    const queue = createTenantQueue(boss);
    const received: TenantContext[] = [];

    await queue.work<{ subject: string }>('access-review.sync', ({ tenantContext: receivedContext }) => {
      received.push(receivedContext);
    });
    const jobId = await queue.enqueue('access-review.sync', {
      tenantContext,
      payload: { subject: 'payroll' },
    });

    await boss.run('access-review.sync', { id: jobId ?? 'missing-job', data: boss.sent[0]?.data });

    expect(received).toEqual([tenantContext]);
  });

  it('rejects enqueue without tenant context', async () => {
    const boss = new FakeBoss();
    const queue = createTenantQueue(boss);
    const requestWithoutTenantContext = {
      payload: { subject: 'payroll' },
    } as unknown as TenantJobRequest<{ subject: string }>;

    await expect(queue.enqueue('access-review.sync', requestWithoutTenantContext)).rejects.toThrow(
      MissingTenantContextError,
    );
    expect(boss.sent).toEqual([]);
  });

  it('preserves tenantId end-to-end', async () => {
    const boss = new FakeBoss();
    const queue = createTenantQueue(boss);
    const handledTenantIds: string[] = [];

    await queue.work<{ subject: string }>('access-review.sync', ({ tenantContext }) => {
      handledTenantIds.push(tenantContext.tenantId);
    });
    await queue.enqueue('access-review.sync', {
      tenantContext,
      payload: { subject: 'payroll' },
    });
    await boss.run('access-review.sync', { id: 'job-1', data: boss.sent[0]?.data });

    expect(boss.sent[0]?.data.tenantContext.tenantId).toBe('tenant_acme');
    expect(handledTenantIds).toEqual(['tenant_acme']);
  });

  it('configures retry with backoff when enqueuing', async () => {
    const boss = new FakeBoss();
    const queue = createTenantQueue(boss);

    await queue.enqueue('access-review.sync', {
      tenantContext,
      payload: { subject: 'payroll' },
    });

    expect(boss.sent[0]?.options).toMatchObject({
      retryLimit: 3,
      retryDelay: 30,
      retryBackoff: true,
    });
  });
});
