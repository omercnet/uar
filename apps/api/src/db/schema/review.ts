import {
  REVIEW_CAMPAIGN_STATUSES,
  REVIEW_DECISION_ACTIONS,
  REVIEW_ITEM_STATUSES,
} from '@uar/core';
import { foreignKey, index, pgEnum, pgTable, text, timestamp, unique, uuid } from 'drizzle-orm/pg-core';

import { accessGrants } from './access_grants.js';
import { applications } from './applications.js';
import { externalAccounts } from './external_accounts.js';
import { snapshots } from './snapshots.js';
import { tenants } from './tenants.js';
import { userIdentities } from './user_identities.js';

export const reviewCampaignStatusEnum = pgEnum('review_campaign_status', REVIEW_CAMPAIGN_STATUSES);
export const reviewItemStatusEnum = pgEnum('review_item_status', REVIEW_ITEM_STATUSES);
export const reviewDecisionActionEnum = pgEnum('review_decision_action', REVIEW_DECISION_ACTIONS);

export const reviewCampaigns = pgTable(
  'review_campaigns',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    tenantId: uuid('tenant_id').notNull(),
    snapshotId: uuid('snapshot_id').notNull(),
    name: text('name').notNull(),
    status: reviewCampaignStatusEnum('status').default('draft').notNull(),
    startsAt: timestamp('starts_at', { withTimezone: true }).notNull(),
    dueAt: timestamp('due_at', { withTimezone: true }).notNull(),
    completedAt: timestamp('completed_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    foreignKey({
      columns: [table.tenantId],
      foreignColumns: [tenants.tenantId],
      name: 'review_campaigns_tenant_id_fk',
    }),
    foreignKey({
      columns: [table.tenantId, table.snapshotId],
      foreignColumns: [snapshots.tenantId, snapshots.id],
      name: 'review_campaigns_snapshot_fk',
    }),
    unique('review_campaigns_tenant_id_id_unique').on(table.tenantId, table.id),
    index('review_campaigns_tenant_id_idx').on(table.tenantId),
    index('review_campaigns_snapshot_idx').on(table.tenantId, table.snapshotId),
  ],
);

export const reviewItems = pgTable(
  'review_items',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    tenantId: uuid('tenant_id').notNull(),
    campaignId: uuid('campaign_id').notNull(),
    snapshotId: uuid('snapshot_id').notNull(),
    accessGrantId: uuid('access_grant_id').notNull(),
    applicationId: uuid('application_id').notNull(),
    externalAccountId: uuid('external_account_id').notNull(),
    status: reviewItemStatusEnum('status').default('pending').notNull(),
    decisionId: uuid('decision_id'),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    foreignKey({
      columns: [table.tenantId],
      foreignColumns: [tenants.tenantId],
      name: 'review_items_tenant_id_fk',
    }),
    foreignKey({
      columns: [table.tenantId, table.campaignId],
      foreignColumns: [reviewCampaigns.tenantId, reviewCampaigns.id],
      name: 'review_items_campaign_fk',
    }),
    foreignKey({
      columns: [table.tenantId, table.snapshotId],
      foreignColumns: [snapshots.tenantId, snapshots.id],
      name: 'review_items_snapshot_fk',
    }),
    foreignKey({
      columns: [table.tenantId, table.accessGrantId],
      foreignColumns: [accessGrants.tenantId, accessGrants.id],
      name: 'review_items_access_grant_fk',
    }),
    foreignKey({
      columns: [table.tenantId, table.applicationId],
      foreignColumns: [applications.tenantId, applications.id],
      name: 'review_items_application_fk',
    }),
    foreignKey({
      columns: [table.tenantId, table.externalAccountId],
      foreignColumns: [externalAccounts.tenantId, externalAccounts.id],
      name: 'review_items_external_account_fk',
    }),
    unique('review_items_tenant_id_id_unique').on(table.tenantId, table.id),
    unique('review_items_tenant_campaign_access_grant_unique').on(
      table.tenantId,
      table.campaignId,
      table.accessGrantId,
    ),
    index('review_items_tenant_id_idx').on(table.tenantId),
    index('review_items_campaign_idx').on(table.tenantId, table.campaignId),
  ],
);

export const reviewAssignments = pgTable(
  'review_assignments',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    tenantId: uuid('tenant_id').notNull(),
    campaignId: uuid('campaign_id').notNull(),
    reviewItemId: uuid('review_item_id').notNull(),
    reviewerUserId: uuid('reviewer_user_id').notNull(),
    status: text('status').default('assigned').notNull(),
    assignedAt: timestamp('assigned_at', { withTimezone: true }).notNull(),
    dueAt: timestamp('due_at', { withTimezone: true }),
  },
  (table) => [
    foreignKey({
      columns: [table.tenantId],
      foreignColumns: [tenants.tenantId],
      name: 'review_assignments_tenant_id_fk',
    }),
    foreignKey({
      columns: [table.tenantId, table.campaignId],
      foreignColumns: [reviewCampaigns.tenantId, reviewCampaigns.id],
      name: 'review_assignments_campaign_fk',
    }),
    foreignKey({
      columns: [table.tenantId, table.reviewItemId],
      foreignColumns: [reviewItems.tenantId, reviewItems.id],
      name: 'review_assignments_item_fk',
    }),
    foreignKey({
      columns: [table.tenantId, table.reviewerUserId],
      foreignColumns: [userIdentities.tenantId, userIdentities.id],
      name: 'review_assignments_reviewer_fk',
    }),
    unique('review_assignments_tenant_id_id_unique').on(table.tenantId, table.id),
    index('review_assignments_tenant_id_idx').on(table.tenantId),
    index('review_assignments_item_idx').on(table.tenantId, table.reviewItemId),
  ],
);

export const reviewDecisions = pgTable(
  'review_decisions',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    tenantId: uuid('tenant_id').notNull(),
    campaignId: uuid('campaign_id').notNull(),
    reviewItemId: uuid('review_item_id').notNull(),
    reviewerUserId: uuid('reviewer_user_id').notNull(),
    decision: reviewDecisionActionEnum('decision').notNull(),
    note: text('note').notNull(),
    decidedAt: timestamp('decided_at', { withTimezone: true }).notNull(),
  },
  (table) => [
    foreignKey({
      columns: [table.tenantId],
      foreignColumns: [tenants.tenantId],
      name: 'review_decisions_tenant_id_fk',
    }),
    foreignKey({
      columns: [table.tenantId, table.campaignId],
      foreignColumns: [reviewCampaigns.tenantId, reviewCampaigns.id],
      name: 'review_decisions_campaign_fk',
    }),
    foreignKey({
      columns: [table.tenantId, table.reviewItemId],
      foreignColumns: [reviewItems.tenantId, reviewItems.id],
      name: 'review_decisions_item_fk',
    }),
    foreignKey({
      columns: [table.tenantId, table.reviewerUserId],
      foreignColumns: [userIdentities.tenantId, userIdentities.id],
      name: 'review_decisions_reviewer_fk',
    }),
    unique('review_decisions_tenant_id_id_unique').on(table.tenantId, table.id),
    unique('review_decisions_tenant_item_unique').on(table.tenantId, table.reviewItemId),
    index('review_decisions_tenant_id_idx').on(table.tenantId),
    index('review_decisions_item_idx').on(table.tenantId, table.reviewItemId),
  ],
);
