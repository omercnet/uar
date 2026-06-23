import { INGEST_CONNECTOR_JOB_NAME, runCsvIngestJob } from '@uar/api';
import type { CsvIngestJobPayload, CsvIngestJobResult, IngestJobStore } from '@uar/api';

import type { TenantJobHandler } from '../queue.js';

export { INGEST_CONNECTOR_JOB_NAME, runCsvIngestJob } from '@uar/api';
export type { CsvIngestJobPayload, CsvIngestJobResult, IngestJobInput, IngestJobStore } from '@uar/api';

export interface RegisterCsvIngestJobDependencies {
  readonly store: IngestJobStore;
}

export interface CsvIngestQueue {
  work(
    name: typeof INGEST_CONNECTOR_JOB_NAME,
    handler: TenantJobHandler<CsvIngestJobPayload, CsvIngestJobResult>,
  ): Promise<string>;
}

export async function registerCsvIngestJob(
  queue: CsvIngestQueue,
  dependencies: RegisterCsvIngestJobDependencies,
): Promise<string> {
  return queue.work(INGEST_CONNECTOR_JOB_NAME, (input) => runCsvIngestJob(input, dependencies));
}
