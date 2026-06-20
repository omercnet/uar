import { createHash } from 'node:crypto';

import { ReviewAssignmentSchema, ReviewDecisionSchema } from '@uar/core';
import { z } from 'zod';

const nonEmptyStringSchema = z.string().min(1);
const jsonValueSchema = z.json();

export const ReviewContentHashSchema = z.string().regex(/^[0-9a-f]{64}$/);
export type ReviewContentHash = z.infer<typeof ReviewContentHashSchema>;

export const ReviewContentNodeSchema = z
  .object({
    tenantId: nonEmptyStringSchema,
    snapshotId: nonEmptyStringSchema,
    nodeType: nonEmptyStringSchema,
    stableId: nonEmptyStringSchema,
    label: nonEmptyStringSchema,
    payload: z.record(nonEmptyStringSchema, jsonValueSchema),
  })
  .strict();
export type ReviewContentNode = z.infer<typeof ReviewContentNodeSchema>;

export const ReviewContentEdgeSchema = z
  .object({
    tenantId: nonEmptyStringSchema,
    snapshotId: nonEmptyStringSchema,
    sourceNodeStableId: nonEmptyStringSchema,
    targetNodeStableId: nonEmptyStringSchema,
    edgeType: nonEmptyStringSchema,
    payload: z.record(nonEmptyStringSchema, jsonValueSchema),
  })
  .strict();
export type ReviewContentEdge = z.infer<typeof ReviewContentEdgeSchema>;

export const ReviewContentInputSchema = z
  .object({
    nodes: z.array(ReviewContentNodeSchema).readonly(),
    edges: z.array(ReviewContentEdgeSchema).readonly(),
    decisions: z.array(ReviewDecisionSchema).readonly(),
    assignments: z.array(ReviewAssignmentSchema).readonly(),
  });
export type ReviewContentInput = z.infer<typeof ReviewContentInputSchema>;

export class CanonicalJsonError extends Error {
  override readonly name = 'CanonicalJsonError';

  constructor(readonly reason: string) {
    super(`Cannot canonicalize review content: ${reason}`);
  }
}

export function computeReviewContentHash(input: ReviewContentInput): ReviewContentHash {
  const digest = createHash('sha256').update(canonicalReviewContent(input)).digest('hex');

  return ReviewContentHashSchema.parse(digest);
}

export function canonicalReviewContent(input: ReviewContentInput): string {
  const content = ReviewContentInputSchema.parse(input);

  return [
    canonicalJson(sortCanonically(content.nodes)),
    canonicalJson(sortCanonically(content.edges)),
    canonicalJson(sortCanonically(content.decisions)),
    canonicalJson(sortCanonically(content.assignments)),
  ].join('\n');
}

export function canonicalJson(value: unknown): string {
  return serializeJsonValue(jsonValueSchema.parse(value));
}

function sortCanonically<T>(items: readonly T[]): readonly T[] {
  return [...items].sort((left, right) => compareStrings(canonicalJson(left), canonicalJson(right)));
}

function serializeJsonValue(value: z.infer<typeof jsonValueSchema>): string {
  if (value === null || typeof value !== 'object') {
    const serialized = JSON.stringify(value);

    if (serialized === undefined) {
      throw new CanonicalJsonError('primitive is not JSON serializable');
    }

    return serialized;
  }

  if (Array.isArray(value)) {
    return `[${value.map((item) => serializeJsonValue(item)).join(',')}]`;
  }

  const entries = Object.entries(value).sort(([leftKey], [rightKey]) => compareStrings(leftKey, rightKey));

  return `{${entries
    .map(([key, nestedValue]) => `${JSON.stringify(key)}:${serializeJsonValue(nestedValue)}`)
    .join(',')}}`;
}

function compareStrings(left: string, right: string): number {
  if (left < right) {
    return -1;
  }

  if (left > right) {
    return 1;
  }

  return 0;
}
