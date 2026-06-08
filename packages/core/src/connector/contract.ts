import { z } from 'zod';

const IsoTimestampSchema = z.iso.datetime();
const NonEmptyStringSchema = z.string().min(1);

export const contractVersion = '1.0.0' as const;

export const ContractVersionSchema = z.literal(contractVersion);
export type ContractVersion = z.infer<typeof ContractVersionSchema>;

export const CapabilityDescriptorSchema = z.object({
  contractVersion: ContractVersionSchema,
  connectorId: NonEmptyStringSchema,
  capabilities: z.object({
    users: z.boolean(),
    groups: z.boolean(),
    roles: z.boolean().optional(),
    permissions: z.boolean().optional(),
    access_grants: z.boolean(),
    owners: z.boolean().optional(),
    revoke: z.boolean().optional(),
    evidence_links: z.boolean(),
  }),
});
export type CapabilityDescriptor = z.infer<typeof CapabilityDescriptorSchema>;

export const EvidenceReferenceSchema = z.object({
  evidenceId: NonEmptyStringSchema,
  uri: NonEmptyStringSchema,
  label: NonEmptyStringSchema.optional(),
  mutable: z.boolean(),
  observedAt: IsoTimestampSchema.optional(),
});
export type EvidenceReference = z.infer<typeof EvidenceReferenceSchema>;

export const ConnectorRecordSchema = z.object({
  tenantId: NonEmptyStringSchema,
  applicationId: NonEmptyStringSchema,
  externalAccountId: NonEmptyStringSchema,
  recordType: NonEmptyStringSchema,
  payload: z.record(NonEmptyStringSchema, z.unknown()),
  observedAt: IsoTimestampSchema,
});
export type ConnectorRecord = z.infer<typeof ConnectorRecordSchema>;

/**
 * Cursor is committed AFTER records are consumed/persisted
 * (cursor-commit-after-consume) to guarantee at-least-once delivery and no silent gaps.
 */
export const SyncResultSchema = z.object({
  cursor: NonEmptyStringSchema.nullable(),
  records: z.array(ConnectorRecordSchema),
});
export type SyncResult = z.infer<typeof SyncResultSchema>;

export const ConnectorErrorSchema = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('rate_limit'),
    retryAfterMs: z.number().int().nonnegative(),
  }),
  z.object({
    kind: z.literal('refresh_failure'),
    reason: NonEmptyStringSchema,
  }),
  z.object({
    kind: z.literal('unknown'),
    message: NonEmptyStringSchema,
  }),
]);
export type ConnectorError = z.infer<typeof ConnectorErrorSchema>;
