import {
  ConnectorRecordSchema,
  SyncResultSchema,
  contractVersion,
  decryptSecret,
  type CapabilityDescriptor,
  type ConnectorRecord,
  type EncryptedSecretEnvelope,
  type EncryptionContext,
  type KeyEncryptionProvider,
  type SyncResult,
} from '@uar/core';
import ky from 'ky';
import { z } from 'zod';

const nonEmptyStringSchema = z.string().min(1);
const githubApiPrefixUrl = 'https://api.github.com' as const;

const GitHubConnectorConfigSchema = z.object({
  tenantId: nonEmptyStringSchema,
  applicationId: nonEmptyStringSchema,
  organization: nonEmptyStringSchema,
  observedAt: z.iso.datetime().optional(),
  pageSize: z.number().int().positive().max(100).default(100),
});

const GitHubSyncInputSchema = z.object({
  cursor: z.string().regex(/^[1-9]\d*$/).nullable(),
});

const GitHubUserSchema = z.object({
  id: z.number().int().nonnegative(),
  login: nonEmptyStringSchema,
  html_url: z.url(),
});

const GitHubMembershipSchema = z.object({
  role: z.enum(['admin', 'member']),
  state: nonEmptyStringSchema,
  url: z.url(),
});

const GitHubMemberListSchema = z.array(GitHubUserSchema);

type GitHubConnectorConfig = z.infer<typeof GitHubConnectorConfigSchema>;
type GitHubUser = z.infer<typeof GitHubUserSchema>;
type GitHubMembership = z.infer<typeof GitHubMembershipSchema>;

type GitHubConnectorRuntime = {
  readonly config: GitHubConnectorConfig;
  readonly credentialEnvelope: EncryptedSecretEnvelope;
  readonly credentialProvider: KeyEncryptionProvider;
  readonly credentialContext?: EncryptionContext;
  readonly transport: GitHubTransport;
};

type GitHubMemberPage = {
  readonly members: readonly GitHubUser[];
  readonly nextCursor: string | null;
};

export interface GitHubRequest {
  readonly path: string;
  readonly searchParams: Readonly<Record<string, string>>;
  readonly headers: Readonly<Record<string, string>>;
}

export interface GitHubResponse {
  readonly body: unknown;
  readonly link?: string | null;
}

export interface GitHubTransport {
  request(input: GitHubRequest): Promise<GitHubResponse>;
}

export interface GitHubConnectorConfigInput {
  readonly tenantId: string;
  readonly applicationId: string;
  readonly organization: string;
  readonly credentialEnvelope: EncryptedSecretEnvelope;
  readonly credentialProvider: KeyEncryptionProvider;
  readonly credentialContext?: EncryptionContext;
  readonly observedAt?: string;
  readonly pageSize?: number;
  readonly transport?: GitHubTransport;
}

export interface GitHubSyncInput {
  readonly cursor: string | null;
}

export interface GitHubConnector {
  readonly descriptor: CapabilityDescriptor;
  sync(input: GitHubSyncInput): AsyncIterable<SyncResult>;
}

export class GitHubConnectorCredentialError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'GitHubConnectorCredentialError';
  }
}

export class GitHubConnectorResponseError extends Error {
  constructor(resource: string, reason: string) {
    super(`Invalid GitHub ${resource} response: ${reason}`);
    this.name = 'GitHubConnectorResponseError';
  }
}

export const GITHUB_CONNECTOR_ID = 'github-organization' as const;

export const GITHUB_DESCRIPTOR = {
  contractVersion,
  connectorId: GITHUB_CONNECTOR_ID,
  capabilities: {
    users: true,
    groups: false,
    roles: true,
    permissions: false,
    access_grants: true,
    owners: false,
    revoke: false,
    evidence_links: true,
  },
} satisfies CapabilityDescriptor;

export function createGitHubConnector(configInput: GitHubConnectorConfigInput): GitHubConnector {
  const runtime = {
    config: GitHubConnectorConfigSchema.parse(configInput),
    credentialEnvelope: configInput.credentialEnvelope,
    credentialProvider: configInput.credentialProvider,
    credentialContext: configInput.credentialContext,
    transport: configInput.transport ?? new KyGitHubTransport(),
  } satisfies GitHubConnectorRuntime;

  return {
    descriptor: GITHUB_DESCRIPTOR,
    sync: async function* sync(input) {
      const parsedInput = GitHubSyncInputSchema.parse(input);
      const token = await decryptGitHubToken(runtime);
      let pageNumber = parsedInput.cursor === null ? 1 : Number(parsedInput.cursor);
      let nextCursor: string | null = String(pageNumber);

      while (nextCursor !== null) {
        const page = await listOrganizationMembers(runtime, pageNumber, token);

        if (page.members.length === 0) {
          return;
        }

        const records = await Promise.all(
          page.members.map(async (member) =>
            toConnectorRecord(runtime.config, member, await readOrganizationMembership(runtime, member.login, token)),
          ),
        );

        yield SyncResultSchema.parse({ cursor: page.nextCursor, records });

        nextCursor = page.nextCursor;
        pageNumber += 1;
      }
    },
  };
}

class KyGitHubTransport implements GitHubTransport {
  private readonly client = ky.create({
    prefixUrl: githubApiPrefixUrl,
    retry: { limit: 2 },
    timeout: 30_000,
  });

  async request(input: GitHubRequest): Promise<GitHubResponse> {
    const path = input.path.startsWith('/') ? input.path.slice(1) : input.path;
    const response = await this.client.get(path, {
      headers: input.headers,
      searchParams: input.searchParams,
    });

    return {
      body: await response.json<unknown>(),
      link: response.headers.get('link'),
    };
  }
}

async function decryptGitHubToken(runtime: GitHubConnectorRuntime): Promise<string> {
  const plaintext = await decryptSecret({
    envelope: runtime.credentialEnvelope,
    provider: runtime.credentialProvider,
    context: runtime.credentialContext,
  });
  const parsed = nonEmptyStringSchema.safeParse(plaintext);

  if (!parsed.success) {
    throw new GitHubConnectorCredentialError(`GitHub token failed validation: ${parsed.error.message}`);
  }

  return parsed.data;
}

async function listOrganizationMembers(
  runtime: GitHubConnectorRuntime,
  pageNumber: number,
  token: string,
): Promise<GitHubMemberPage> {
  const response = await runtime.transport.request({
    path: `/orgs/${toPathSegment(runtime.config.organization)}/members`,
    searchParams: {
      page: String(pageNumber),
      per_page: String(runtime.config.pageSize),
    },
    headers: toGitHubHeaders(token),
  });
  const members = parseGitHubResponse(GitHubMemberListSchema, response.body, 'organization members');

  return {
    members,
    nextCursor: linkHeaderHasNextPage(response.link ?? null) ? String(pageNumber + 1) : null,
  };
}

async function readOrganizationMembership(
  runtime: GitHubConnectorRuntime,
  login: string,
  token: string,
): Promise<GitHubMembership> {
  const response = await runtime.transport.request({
    path: `/orgs/${toPathSegment(runtime.config.organization)}/memberships/${toPathSegment(login)}`,
    searchParams: {},
    headers: toGitHubHeaders(token),
  });

  return parseGitHubResponse(GitHubMembershipSchema, response.body, `membership for ${login}`);
}

function toConnectorRecord(
  config: GitHubConnectorConfig,
  user: GitHubUser,
  membership: GitHubMembership,
): ConnectorRecord {
  const externalAccountId = `github_user_${user.id}`;
  const record = {
    tenantId: config.tenantId,
    applicationId: config.applicationId,
    externalAccountId,
    recordType: 'access_grant',
    payload: {
      externalAccountId,
      login: user.login,
      displayName: user.login,
      grantId: `github:${config.organization}:member:${user.id}:org-role:${membership.role}`,
      accessType: 'github_org_role',
      accessId: `github:${config.organization}:org-role:${membership.role}`,
      accessLabel: `GitHub ${config.organization} organization ${membership.role}`,
      membershipState: membership.state,
      profileUrl: user.html_url,
      membershipUrl: membership.url,
      source: 'github-organization',
    },
    observedAt: config.observedAt ?? new Date().toISOString(),
  } satisfies ConnectorRecord;

  return ConnectorRecordSchema.parse(record);
}

function parseGitHubResponse<T>(schema: z.ZodType<T>, body: unknown, resource: string): T {
  const parsed = schema.safeParse(body);

  if (!parsed.success) {
    throw new GitHubConnectorResponseError(resource, parsed.error.message);
  }

  return parsed.data;
}

function toGitHubHeaders(token: string): Readonly<Record<string, string>> {
  return {
    accept: 'application/vnd.github+json',
    authorization: `Bearer ${token}`,
    'user-agent': 'uar-github-connector',
    'x-github-api-version': '2022-11-28',
  };
}

function toPathSegment(value: string): string {
  return encodeURIComponent(value);
}

function linkHeaderHasNextPage(linkHeader: string | null): boolean {
  return linkHeader?.split(',').some((link) => link.includes('rel="next"')) ?? false;
}
