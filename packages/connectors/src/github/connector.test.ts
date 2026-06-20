import {
  CapabilityDescriptorSchema,
  ConnectorRecordSchema,
  SyncResultSchema,
  createLocalKeyEncryptionProvider,
  encryptSecret,
  type EncryptedSecretEnvelope,
  type KeyEncryptionProvider,
  type SyncResult,
} from '@uar/core';
import { describe, expect, it } from 'vitest';

import {
  GITHUB_CONNECTOR_ID,
  GITHUB_DESCRIPTOR,
  GitHubConnectorResponseError,
  createGitHubConnector,
  type GitHubRequest,
  type GitHubResponse,
  type GitHubTransport,
} from './connector.js';

const observedAt = '2026-06-08T12:00:00.000Z';
const encryptedTokenContext = {
  tenantId: 'tenant_acme',
  connectorId: GITHUB_CONNECTOR_ID,
} as const;

async function collectSyncResults(results: AsyncIterable<SyncResult>): Promise<readonly SyncResult[]> {
  const pages: SyncResult[] = [];

  for await (const page of results) {
    pages.push(SyncResultSchema.parse(page));
  }

  return pages;
}

function deterministicRandomBytes(byteLength: number): Uint8Array {
  return new Uint8Array(byteLength).fill(7);
}

function createCredentialProvider(): KeyEncryptionProvider {
  return createLocalKeyEncryptionProvider({
    masterKey: `hex:${'11'.repeat(32)}`,
    randomBytes: deterministicRandomBytes,
  });
}

async function encryptGitHubToken(provider: KeyEncryptionProvider): Promise<EncryptedSecretEnvelope> {
  return encryptSecret({
    plaintext: 'github_pat_test_token',
    provider,
    context: encryptedTokenContext,
  });
}

class FixtureGitHubTransport implements GitHubTransport {
  readonly requests: GitHubRequest[] = [];

  constructor(private readonly responses: Readonly<Record<string, GitHubResponse>>) {}

  async request(input: GitHubRequest): Promise<GitHubResponse> {
    this.requests.push(input);
    const page = input.searchParams['page'];
    const key = page === undefined ? input.path : `${input.path}?page=${page}`;
    const response = this.responses[key];

    if (response === undefined) {
      throw new Error(`Missing GitHub fixture for ${key}`);
    }

    return response;
  }
}

describe('github connector', () => {
  it('T17-C1 exposes a valid GitHub organization access capability descriptor', () => {
    expect(CapabilityDescriptorSchema.parse(GITHUB_DESCRIPTOR)).toEqual({
      contractVersion: '1.0.0',
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
    });
  });

  it('T17-C2 decrypts credentials, authenticates GitHub requests, paginates, and maps organization roles to access grants', async () => {
    const provider = createCredentialProvider();
    const credentialEnvelope = await encryptGitHubToken(provider);
    const transport = new FixtureGitHubTransport({
      '/orgs/acme/members?page=1': {
        body: [
          {
            id: 101,
            login: 'ada',
            html_url: 'https://github.com/ada',
            type: 'User',
            site_admin: false,
          },
          {
            id: 102,
            login: 'grace',
            html_url: 'https://github.com/grace',
            type: 'User',
            site_admin: false,
          },
        ],
        link: '<https://api.github.com/orgs/acme/members?page=2&per_page=2>; rel="next"',
      },
      '/orgs/acme/members?page=2': {
        body: [
          {
            id: 103,
            login: 'linus',
            html_url: 'https://github.com/linus',
            type: 'User',
            site_admin: false,
          },
        ],
      },
      '/orgs/acme/memberships/ada': {
        body: { role: 'admin', state: 'active', url: 'https://api.github.com/orgs/acme/memberships/ada' },
      },
      '/orgs/acme/memberships/grace': {
        body: { role: 'member', state: 'active', url: 'https://api.github.com/orgs/acme/memberships/grace' },
      },
      '/orgs/acme/memberships/linus': {
        body: { role: 'member', state: 'active', url: 'https://api.github.com/orgs/acme/memberships/linus' },
      },
    });
    const connector = createGitHubConnector({
      tenantId: 'tenant_acme',
      applicationId: 'app_github',
      organization: 'acme',
      credentialEnvelope,
      credentialProvider: provider,
      credentialContext: encryptedTokenContext,
      observedAt,
      pageSize: 2,
      transport,
    });

    const pages = await collectSyncResults(connector.sync({ cursor: null }));

    expect(pages.map((page) => page.cursor)).toEqual(['2', null]);
    expect(transport.requests.every((request) => request.headers.authorization === 'Bearer github_pat_test_token')).toBe(
      true,
    );
    const records = pages.flatMap((page) => page.records).map((record) => ConnectorRecordSchema.parse(record));

    expect(records.map((record) => record.externalAccountId)).toEqual([
      'github_user_101',
      'github_user_102',
      'github_user_103',
    ]);
    expect(records[0]).toEqual({
      tenantId: 'tenant_acme',
      applicationId: 'app_github',
      externalAccountId: 'github_user_101',
      recordType: 'access_grant',
      payload: {
        externalAccountId: 'github_user_101',
        login: 'ada',
        displayName: 'ada',
        grantId: 'github:acme:member:101:org-role:admin',
        accessType: 'github_org_role',
        accessId: 'github:acme:org-role:admin',
        accessLabel: 'GitHub acme organization admin',
        membershipState: 'active',
        profileUrl: 'https://github.com/ada',
        membershipUrl: 'https://api.github.com/orgs/acme/memberships/ada',
        source: 'github-organization',
      },
      observedAt,
    });
    expect(records[1]?.payload['accessId']).toBe('github:acme:org-role:member');
    expect(records[2]?.payload['membershipUrl']).toBe('https://api.github.com/orgs/acme/memberships/linus');
  });

  it('T17-C3 resumes from a committed GitHub page cursor without replaying prior pages', async () => {
    const provider = createCredentialProvider();
    const credentialEnvelope = await encryptGitHubToken(provider);
    const transport = new FixtureGitHubTransport({
      '/orgs/acme/members?page=2': {
        body: [
          {
            id: 103,
            login: 'linus',
            html_url: 'https://github.com/linus',
            type: 'User',
            site_admin: false,
          },
        ],
      },
      '/orgs/acme/memberships/linus': {
        body: { role: 'member', state: 'active', url: 'https://api.github.com/orgs/acme/memberships/linus' },
      },
    });
    const connector = createGitHubConnector({
      tenantId: 'tenant_acme',
      applicationId: 'app_github',
      organization: 'acme',
      credentialEnvelope,
      credentialProvider: provider,
      credentialContext: encryptedTokenContext,
      observedAt,
      pageSize: 2,
      transport,
    });

    const pages = await collectSyncResults(connector.sync({ cursor: '2' }));

    expect(transport.requests[0]?.path).toBe('/orgs/acme/members');
    expect(transport.requests[0]?.searchParams['page']).toBe('2');
    expect(pages).toHaveLength(1);
    expect(pages[0]?.cursor).toBeNull();
    expect(pages[0]?.records[0]?.externalAccountId).toBe('github_user_103');
  });

  it('T17-C4 rejects invalid GitHub API responses at the Zod boundary', async () => {
    const provider = createCredentialProvider();
    const credentialEnvelope = await encryptGitHubToken(provider);
    const transport = new FixtureGitHubTransport({
      '/orgs/acme/members?page=1': {
        body: { login: 'ada' },
      },
    });
    const connector = createGitHubConnector({
      tenantId: 'tenant_acme',
      applicationId: 'app_github',
      organization: 'acme',
      credentialEnvelope,
      credentialProvider: provider,
      credentialContext: encryptedTokenContext,
      observedAt,
      transport,
    });

    await expect(collectSyncResults(connector.sync({ cursor: null }))).rejects.toThrow(
      GitHubConnectorResponseError,
    );
  });
});
