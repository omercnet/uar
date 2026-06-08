import { z } from 'zod';

const IsoTimestampSchema = z.iso.datetime();
const NonEmptyStringSchema = z.string().min(1);
const MetadataSchema = z.record(NonEmptyStringSchema, z.unknown());

export const TenantSchema = z.object({
  tenantId: NonEmptyStringSchema,
  name: NonEmptyStringSchema,
  status: z.enum(['active', 'suspended', 'archived']),
  createdAt: IsoTimestampSchema,
  updatedAt: IsoTimestampSchema.optional(),
});
export type Tenant = z.infer<typeof TenantSchema>;

export const UserIdentitySchema = z.object({
  tenantId: NonEmptyStringSchema,
  userId: NonEmptyStringSchema,
  email: z.string().email(),
  displayName: NonEmptyStringSchema,
  status: z.enum(['active', 'inactive', 'suspended']),
  createdAt: IsoTimestampSchema,
  updatedAt: IsoTimestampSchema.optional(),
});
export type UserIdentity = z.infer<typeof UserIdentitySchema>;

export const ExternalAccountSchema = z.object({
  tenantId: NonEmptyStringSchema,
  externalAccountId: NonEmptyStringSchema,
  applicationId: NonEmptyStringSchema,
  userId: NonEmptyStringSchema.optional(),
  externalId: NonEmptyStringSchema,
  displayName: NonEmptyStringSchema.optional(),
  email: z.string().email().optional(),
  status: z.enum(['active', 'inactive', 'unknown']),
  observedAt: IsoTimestampSchema,
});
export type ExternalAccount = z.infer<typeof ExternalAccountSchema>;

export const ApplicationSchema = z.object({
  tenantId: NonEmptyStringSchema,
  applicationId: NonEmptyStringSchema,
  name: NonEmptyStringSchema,
  connectorId: NonEmptyStringSchema,
  status: z.enum(['active', 'inactive', 'archived']),
  ownerUserId: NonEmptyStringSchema.optional(),
  createdAt: IsoTimestampSchema,
  updatedAt: IsoTimestampSchema.optional(),
});
export type Application = z.infer<typeof ApplicationSchema>;

export const AccessGrantSchema = z.object({
  tenantId: NonEmptyStringSchema,
  accessGrantId: NonEmptyStringSchema,
  applicationId: NonEmptyStringSchema,
  externalAccountId: NonEmptyStringSchema,
  accessType: z.enum(['role', 'permission', 'group', 'owner', 'direct']),
  accessId: NonEmptyStringSchema,
  source: NonEmptyStringSchema,
  grantedAt: IsoTimestampSchema.optional(),
  observedAt: IsoTimestampSchema,
});
export type AccessGrant = z.infer<typeof AccessGrantSchema>;

export const RolePermissionSchema = z.object({
  tenantId: NonEmptyStringSchema,
  rolePermissionId: NonEmptyStringSchema,
  applicationId: NonEmptyStringSchema,
  roleId: NonEmptyStringSchema,
  permissionId: NonEmptyStringSchema,
  description: NonEmptyStringSchema.optional(),
  observedAt: IsoTimestampSchema,
});
export type RolePermission = z.infer<typeof RolePermissionSchema>;

export const ReviewCampaignSchema = z.object({
  tenantId: NonEmptyStringSchema,
  campaignId: NonEmptyStringSchema,
  name: NonEmptyStringSchema,
  snapshotId: NonEmptyStringSchema,
  status: z.enum(['draft', 'active', 'completed', 'cancelled']),
  startsAt: IsoTimestampSchema,
  dueAt: IsoTimestampSchema,
  createdAt: IsoTimestampSchema,
});
export type ReviewCampaign = z.infer<typeof ReviewCampaignSchema>;

export const ReviewItemSchema = z.object({
  tenantId: NonEmptyStringSchema,
  reviewItemId: NonEmptyStringSchema,
  campaignId: NonEmptyStringSchema,
  accessGrantId: NonEmptyStringSchema,
  applicationId: NonEmptyStringSchema,
  externalAccountId: NonEmptyStringSchema,
  status: z.enum(['pending', 'assigned', 'decided', 'exception']),
  decisionId: NonEmptyStringSchema.optional(),
  createdAt: IsoTimestampSchema,
});
export type ReviewItem = z.infer<typeof ReviewItemSchema>;

export const ReviewAssignmentSchema = z.object({
  tenantId: NonEmptyStringSchema,
  assignmentId: NonEmptyStringSchema,
  campaignId: NonEmptyStringSchema,
  reviewItemId: NonEmptyStringSchema,
  reviewerUserId: NonEmptyStringSchema,
  status: z.enum(['assigned', 'completed', 'reassigned']),
  assignedAt: IsoTimestampSchema,
  dueAt: IsoTimestampSchema.optional(),
});
export type ReviewAssignment = z.infer<typeof ReviewAssignmentSchema>;

export const ReviewDecisionSchema = z.object({
  tenantId: NonEmptyStringSchema,
  decisionId: NonEmptyStringSchema,
  campaignId: NonEmptyStringSchema,
  reviewItemId: NonEmptyStringSchema,
  reviewerUserId: NonEmptyStringSchema,
  decision: z.enum(['approve', 'revoke', 'exception']),
  decidedAt: IsoTimestampSchema,
  note: z.string(),
});
export type ReviewDecision = z.infer<typeof ReviewDecisionSchema>;

export const EvidenceArtifactSchema = z.object({
  tenantId: NonEmptyStringSchema,
  evidenceArtifactId: NonEmptyStringSchema,
  contentHash: NonEmptyStringSchema,
  contentType: NonEmptyStringSchema,
  byteSize: z.number().int().nonnegative(),
  immutable: z.literal(true),
  createdAt: IsoTimestampSchema,
  storageUri: NonEmptyStringSchema.optional(),
});
export type EvidenceArtifact = z.infer<typeof EvidenceArtifactSchema>;

export const AuditLogEventSchema = z.object({
  tenantId: NonEmptyStringSchema,
  auditLogEventId: NonEmptyStringSchema,
  actorUserId: NonEmptyStringSchema.optional(),
  eventType: NonEmptyStringSchema,
  targetType: NonEmptyStringSchema,
  targetId: NonEmptyStringSchema,
  occurredAt: IsoTimestampSchema,
  metadata: MetadataSchema.optional(),
});
export type AuditLogEvent = z.infer<typeof AuditLogEventSchema>;
