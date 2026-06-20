import { Buffer } from 'node:buffer';

import { EvidenceArtifactSchema, type EvidenceArtifact } from '@uar/core';
import { z } from 'zod';

import {
  ReviewContentHashSchema,
  ReviewContentInputSchema,
  canonicalReviewContent,
  computeReviewContentHash,
  type ReviewContentHash,
} from './content-hash.js';

export const REVIEW_FINALIZATION_CONTENT_TYPE = 'application/vnd.uar.review-finalize+json' as const;

const nonEmptyStringSchema = z.string().min(1);
const isoTimestampSchema = z.iso.datetime();

export const FinalizeReviewExportInputSchema = ReviewContentInputSchema.extend({
  tenantId: nonEmptyStringSchema,
  campaignId: nonEmptyStringSchema,
  snapshotId: nonEmptyStringSchema,
  finalizedAt: isoTimestampSchema,
}).strict();
export type FinalizeReviewExportInput = z.infer<typeof FinalizeReviewExportInputSchema>;

export interface FindFinalizationArtifactInput {
  readonly tenantId: string;
  readonly contentHash: ReviewContentHash;
}

export interface StoredFinalizationArtifact {
  readonly artifact: EvidenceArtifact;
  readonly canonicalContent: string;
}

export interface FinalizationArtifactStore {
  findByContentHash(input: FindFinalizationArtifactInput): StoredFinalizationArtifact | undefined;
  save(record: StoredFinalizationArtifact): StoredFinalizationArtifact;
}

export interface FinalizedReviewExport extends StoredFinalizationArtifact {
  readonly contentHash: ReviewContentHash;
  readonly created: boolean;
}

export class InMemoryFinalizationArtifactStore implements FinalizationArtifactStore {
  private readonly records = new Map<string, StoredFinalizationArtifact>();
  private writes = 0;

  get saveCount(): number {
    return this.writes;
  }

  findByContentHash(input: FindFinalizationArtifactInput): StoredFinalizationArtifact | undefined {
    return this.records.get(recordKey(input));
  }

  save(record: StoredFinalizationArtifact): StoredFinalizationArtifact {
    const contentHash = ReviewContentHashSchema.parse(record.artifact.contentHash);
    const key = recordKey({ tenantId: record.artifact.tenantId, contentHash });
    const existing = this.records.get(key);

    if (existing !== undefined) {
      return existing;
    }

    this.records.set(key, record);
    this.writes += 1;

    return record;
  }

  artifacts(): readonly EvidenceArtifact[] {
    return [...this.records.values()].map((record) => record.artifact);
  }
}

export function finalizeReviewExport(
  input: FinalizeReviewExportInput,
  store: FinalizationArtifactStore,
): FinalizedReviewExport {
  const parsedInput = FinalizeReviewExportInputSchema.parse(input);
  const canonicalContent = canonicalReviewContent(parsedInput);
  const contentHash = computeReviewContentHash(parsedInput);
  const existing = store.findByContentHash({ tenantId: parsedInput.tenantId, contentHash });

  if (existing !== undefined) {
    return {
      ...existing,
      contentHash,
      created: false,
    };
  }

  const record = {
    artifact: EvidenceArtifactSchema.parse({
      tenantId: parsedInput.tenantId,
      evidenceArtifactId: `sha256:${contentHash}`,
      contentHash,
      contentType: REVIEW_FINALIZATION_CONTENT_TYPE,
      byteSize: Buffer.byteLength(canonicalContent, 'utf8'),
      immutable: true,
      createdAt: parsedInput.finalizedAt,
    }),
    canonicalContent,
  } satisfies StoredFinalizationArtifact;
  const saved = store.save(record);

  return {
    ...saved,
    contentHash,
    created: true,
  };
}

function recordKey(input: FindFinalizationArtifactInput): string {
  return `${input.tenantId}:${input.contentHash}`;
}
