import { z } from 'zod';

import {
  EvidenceSinkWriteInputSchema,
  type EvidenceSink,
  type EvidenceSinkWriteInput,
  type EvidenceSinkWriteResult,
} from './sink.js';

const nonEmptyStringSchema = z.string().min(1);

const DrataEvidenceSinkConfigSchema = z
  .object({
    controlId: nonEmptyStringSchema,
  })
  .strict();
type DrataEvidenceSinkConfig = z.infer<typeof DrataEvidenceSinkConfigSchema>;

export interface DrataEvidenceSinkConfigInput {
  readonly controlId: string;
}

export class DrataEvidenceSinkUnavailableError extends Error {
  override readonly name = 'DrataEvidenceSinkUnavailableError';

  constructor(readonly controlId: string) {
    super(`Drata evidence sink is not implemented for control '${controlId}'`);
  }
}

export class DrataEvidenceSinkStub implements EvidenceSink {
  readonly sinkKind = 'drata' as const;
  private readonly config: DrataEvidenceSinkConfig;

  constructor(configInput: DrataEvidenceSinkConfigInput) {
    this.config = DrataEvidenceSinkConfigSchema.parse(configInput);
  }

  async write(input: EvidenceSinkWriteInput): Promise<EvidenceSinkWriteResult> {
    EvidenceSinkWriteInputSchema.parse(input);
    throw new DrataEvidenceSinkUnavailableError(this.config.controlId);
  }
}
