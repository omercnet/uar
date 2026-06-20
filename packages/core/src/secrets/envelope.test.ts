import { randomBytes } from 'node:crypto';

import { describe, expect, it } from 'vitest';

import { decryptSecret, encryptSecret, type EncryptedSecretEnvelope, type EncryptionContext } from './envelope.js';
import { createLocalKeyEncryptionProvider } from './provider.js';

const secretPlaintext = JSON.stringify({
  clientId: 'github-client-id',
  clientSecret: 'github_pat_super_secret',
});

const context = {
  tenantId: 'tenant_acme',
  connectorId: 'github-oauth',
  secretName: 'oauth-client-secret',
} satisfies EncryptionContext;

function createTestProvider() {
  return createLocalKeyEncryptionProvider({
    keyId: 'test-local-master-key',
    masterKey: randomBytes(32),
  });
}

function tamper(value: string): string {
  const bytes = Buffer.from(value, 'base64url');

  if (bytes.length === 0) {
    throw new Error('Cannot tamper with an empty value');
  }

  const firstByte = bytes.at(0);

  if (firstByte === undefined) {
    throw new Error('Cannot tamper with an empty value');
  }

  bytes[0] = firstByte ^ 1;

  return bytes.toString('base64url');
}

function withTamperedCiphertext(envelope: EncryptedSecretEnvelope): EncryptedSecretEnvelope {
  return {
    ...envelope,
    ciphertext: tamper(envelope.ciphertext),
  };
}

function withTamperedTag(envelope: EncryptedSecretEnvelope): EncryptedSecretEnvelope {
  return {
    ...envelope,
    tag: tamper(envelope.tag),
  };
}

describe('secrets envelope encryption', () => {
  it('T7-S1 encrypts and decrypts connector credentials without plaintext at rest', async () => {
    const provider = createTestProvider();

    const envelope = await encryptSecret({ plaintext: secretPlaintext, provider, context });
    const decrypted = await decryptSecret({ envelope, provider, context });

    expect(decrypted).toBe(secretPlaintext);
    expect(envelope.ciphertext).not.toContain('github_pat_super_secret');
    expect(JSON.stringify(envelope)).not.toContain('github_pat_super_secret');
  });

  it('T7-S2 rejects tampered ciphertext and authentication tags', async () => {
    const provider = createTestProvider();
    const envelope = await encryptSecret({ plaintext: secretPlaintext, provider, context });

    await expect(
      decryptSecret({ envelope: withTamperedCiphertext(envelope), provider, context }),
    ).rejects.toThrow(/decrypt/i);
    await expect(decryptSecret({ envelope: withTamperedTag(envelope), provider, context })).rejects.toThrow(
      /decrypt/i,
    );
  });

  it('T7-S3 uses a unique IV so repeated plaintext encryptions differ', async () => {
    const provider = createTestProvider();

    const first = await encryptSecret({ plaintext: secretPlaintext, provider, context });
    const second = await encryptSecret({ plaintext: secretPlaintext, provider, context });

    expect(first.iv).not.toBe(second.iv);
    expect(first.ciphertext).not.toBe(second.ciphertext);
  });
});
