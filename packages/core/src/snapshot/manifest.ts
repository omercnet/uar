import { z } from 'zod';

const IsoTimestampSchema = z.iso.datetime();
const NonEmptyStringSchema = z.string().min(1);

export const SnapshotManifestSchema = z
  .object({
    snapshotId: NonEmptyStringSchema,
    tenantId: NonEmptyStringSchema,
    createdAt: IsoTimestampSchema,
    connectorId: NonEmptyStringSchema,
    recordCounts: z.record(NonEmptyStringSchema, z.number().int().nonnegative()),
    schemaVersion: NonEmptyStringSchema,
  })
  .strict();
export type SnapshotManifest = z.infer<typeof SnapshotManifestSchema>;
