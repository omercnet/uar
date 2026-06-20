import { EvidenceArtifactSchema } from '@uar/core';
import { z } from 'zod';

import { ReviewContentHashSchema } from '../content-hash.js';

const nonEmptyStringSchema = z.string().min(1);

export const EVIDENCE_SINK_KINDS = ['csv-file', 'drata'] as const;
export const EvidenceSinkKindSchema = z.enum(EVIDENCE_SINK_KINDS);
export type EvidenceSinkKind = z.infer<typeof EvidenceSinkKindSchema>;

export const EvidenceSinkSelectedBySchema = z.enum(['tenant-config', 'campaign-override']);
export type EvidenceSinkSelectedBy = z.infer<typeof EvidenceSinkSelectedBySchema>;

export const EvidenceSinkSelectionSchema = z
  .object({
    sinkKind: EvidenceSinkKindSchema,
    selectedBy: EvidenceSinkSelectedBySchema,
  })
  .strict();
export type EvidenceSinkSelection = z.infer<typeof EvidenceSinkSelectionSchema>;

export const TenantEvidenceSinkConfigSchema = z
  .object({
    defaultSinkKind: EvidenceSinkKindSchema.default('csv-file'),
  })
  .strict();
export type TenantEvidenceSinkConfigInput = z.input<typeof TenantEvidenceSinkConfigSchema>;

export const CampaignEvidenceSinkOverrideSchema = z
  .object({
    sinkKind: EvidenceSinkKindSchema.optional(),
  })
  .strict();
export type CampaignEvidenceSinkOverrideInput = z.input<typeof CampaignEvidenceSinkOverrideSchema>;

export const SelectEvidenceSinkInputSchema = z
  .object({
    tenantId: nonEmptyStringSchema,
    campaignId: nonEmptyStringSchema,
    tenantConfig: TenantEvidenceSinkConfigSchema,
    campaignOverride: CampaignEvidenceSinkOverrideSchema.optional(),
  })
  .strict();
export type SelectEvidenceSinkInput = z.input<typeof SelectEvidenceSinkInputSchema>;

export const FinalizedEvidenceForSinkSchema = z
  .object({
    artifact: EvidenceArtifactSchema,
    canonicalContent: nonEmptyStringSchema,
    contentHash: ReviewContentHashSchema,
    created: z.boolean(),
  })
  .strict();
export type FinalizedEvidenceForSink = z.infer<typeof FinalizedEvidenceForSinkSchema>;

export const EvidenceSinkWriteInputSchema = z
  .object({
    tenantId: nonEmptyStringSchema,
    campaignId: nonEmptyStringSchema,
    finalizedExport: FinalizedEvidenceForSinkSchema,
  })
  .strict()
  .refine((input) => input.finalizedExport.artifact.tenantId === input.tenantId, {
    path: ['finalizedExport', 'artifact', 'tenantId'],
    message: 'finalized artifact tenant must match sink tenant',
  });
export type EvidenceSinkWriteInput = z.infer<typeof EvidenceSinkWriteInputSchema>;

export const EvidenceSinkWriteResultSchema = z
  .object({
    artifact: EvidenceArtifactSchema,
    storageUri: nonEmptyStringSchema,
  })
  .strict();
export type EvidenceSinkWriteResult = z.infer<typeof EvidenceSinkWriteResultSchema>;

export const SelectedEvidenceSinkWriteResultSchema = EvidenceSinkWriteResultSchema.extend({
  selection: EvidenceSinkSelectionSchema,
}).strict();
export type SelectedEvidenceSinkWriteResult = z.infer<typeof SelectedEvidenceSinkWriteResultSchema>;

export interface EvidenceSink {
  readonly sinkKind: EvidenceSinkKind;
  write(input: EvidenceSinkWriteInput): Promise<EvidenceSinkWriteResult>;
}

export interface EvidenceSinkRegistry {
  readonly csvFile: EvidenceSink;
  readonly drata?: EvidenceSink;
}

export interface SelectedEvidenceSink {
  readonly selection: EvidenceSinkSelection;
  readonly sink: EvidenceSink;
}

export interface WriteEvidenceToSelectedSinkInput {
  readonly selection: SelectEvidenceSinkInput;
  readonly registry: EvidenceSinkRegistry;
  readonly writeInput: EvidenceSinkWriteInput;
}

export class EvidenceSinkSelectionError extends Error {
  override readonly name = 'EvidenceSinkSelectionError';

  constructor(readonly sinkKind: EvidenceSinkKind) {
    super(`Evidence sink '${sinkKind}' is not registered`);
  }
}

export function selectEvidenceSinkKind(input: SelectEvidenceSinkInput): EvidenceSinkSelection {
  const parsedInput = SelectEvidenceSinkInputSchema.parse(input);
  const campaignSinkKind = parsedInput.campaignOverride?.sinkKind;

  if (campaignSinkKind !== undefined) {
    return EvidenceSinkSelectionSchema.parse({
      sinkKind: campaignSinkKind,
      selectedBy: 'campaign-override',
    });
  }

  return EvidenceSinkSelectionSchema.parse({
    sinkKind: parsedInput.tenantConfig.defaultSinkKind,
    selectedBy: 'tenant-config',
  });
}

export function selectEvidenceSink(
  input: SelectEvidenceSinkInput,
  registry: EvidenceSinkRegistry,
): SelectedEvidenceSink {
  const selection = selectEvidenceSinkKind(input);

  switch (selection.sinkKind) {
    case 'csv-file':
      return { selection, sink: registry.csvFile };
    case 'drata': {
      const drataSink = registry.drata;

      if (drataSink === undefined) {
        throw new EvidenceSinkSelectionError(selection.sinkKind);
      }

      return { selection, sink: drataSink };
    }
    default:
      return assertNever(selection.sinkKind);
  }
}

export async function writeEvidenceToSelectedSink(
  input: WriteEvidenceToSelectedSinkInput,
): Promise<SelectedEvidenceSinkWriteResult> {
  const selected = selectEvidenceSink(input.selection, input.registry);
  const result = await selected.sink.write(EvidenceSinkWriteInputSchema.parse(input.writeInput));

  return SelectedEvidenceSinkWriteResultSchema.parse({
    ...result,
    selection: selected.selection,
  });
}

function assertNever(value: never): never {
  throw new EvidenceSinkSelectionError(value);
}
