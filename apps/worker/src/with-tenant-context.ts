import { TenantContextSchema, type TenantContext } from '@uar/core';

export class MissingTenantContextError extends Error {
  constructor(message = 'Tenant context is required for worker jobs') {
    super(message);
    this.name = 'MissingTenantContextError';
  }
}

export interface TenantJobRequest<TPayload = unknown> {
  tenantContext: TenantContext;
  payload: TPayload;
}

export interface TenantJobEnvelope<TPayload = unknown> {
  tenantContext: TenantContext;
  payload: TPayload;
}

export interface TenantQueueJob {
  id: string;
  data: unknown;
}

export interface TenantJobHandlerInput<TPayload = unknown> {
  jobId: string;
  tenantContext: TenantContext;
  payload: TPayload;
}

export type TenantJobHandler<TPayload = unknown, TResult = void> = (
  input: TenantJobHandlerInput<TPayload>,
) => TResult | Promise<TResult>;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function resolveTenantContext(value: unknown): TenantContext {
  const result = TenantContextSchema.safeParse(value);

  if (!result.success) {
    throw new MissingTenantContextError();
  }

  return result.data;
}

export function createTenantJobEnvelope<TPayload>(
  request: TenantJobRequest<TPayload>,
): TenantJobEnvelope<TPayload> {
  if (!isRecord(request)) {
    throw new MissingTenantContextError();
  }

  return {
    tenantContext: resolveTenantContext(request.tenantContext),
    payload: request.payload,
  };
}

export function resolveTenantJobEnvelope<TPayload>(data: unknown): TenantJobEnvelope<TPayload> {
  if (!isRecord(data)) {
    throw new MissingTenantContextError();
  }

  return {
    tenantContext: resolveTenantContext(data.tenantContext),
    payload: data.payload as TPayload,
  };
}

export function withTenantContext<TPayload, TResult = void>(
  handler: TenantJobHandler<TPayload, TResult>,
): (job: TenantQueueJob) => Promise<TResult> {
  return async (job) => {
    const envelope = resolveTenantJobEnvelope<TPayload>(job.data);

    return handler({
      jobId: job.id,
      tenantContext: envelope.tenantContext,
      payload: envelope.payload,
    });
  };
}
