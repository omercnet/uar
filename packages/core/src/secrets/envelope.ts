import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';

import {
  dataEncryptionAlgorithm,
  decodeBase64Url,
  encodeBase64Url,
  encryptionContextToAad,
  type EncryptedDataKey,
  type EncryptionContext,
  type KeyEncryptionProvider,
} from './provider.js';

export type { EncryptedDataKey, EncryptionContext, KeyEncryptionProvider } from './provider.js';

export const encryptedSecretEnvelopeVersion = 1 as const;

const gcmIvBytes = 12;

export type EncryptedSecretEnvelope = {
  readonly version: typeof encryptedSecretEnvelopeVersion;
  readonly algorithm: typeof dataEncryptionAlgorithm;
  readonly encryptedDataKey: EncryptedDataKey;
  readonly iv: string;
  readonly ciphertext: string;
  readonly tag: string;
};

export type EncryptSecretInput = {
  readonly plaintext: string;
  readonly provider: KeyEncryptionProvider;
  readonly context?: EncryptionContext;
};

export type DecryptSecretInput = {
  readonly envelope: EncryptedSecretEnvelope;
  readonly provider: KeyEncryptionProvider;
  readonly context?: EncryptionContext;
};

export async function encryptSecret({
  plaintext,
  provider,
  context,
}: EncryptSecretInput): Promise<EncryptedSecretEnvelope> {
  const { plaintextKey, encryptedDataKey } = await provider.generateDataKey(context);

  try {
    const iv = randomBytes(gcmIvBytes);
    const cipher = createCipheriv(dataEncryptionAlgorithm, plaintextKey, iv);
    const aad = encryptionContextToAad(context);

    cipher.setAAD(aad);

    const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);

    return {
      version: encryptedSecretEnvelopeVersion,
      algorithm: dataEncryptionAlgorithm,
      encryptedDataKey,
      iv: encodeBase64Url(iv),
      ciphertext: encodeBase64Url(ciphertext),
      tag: encodeBase64Url(cipher.getAuthTag()),
    };
  } finally {
    plaintextKey.fill(0);
  }
}

export async function decryptSecret({
  envelope,
  provider,
  context,
}: DecryptSecretInput): Promise<string> {
  const plaintextKey = await provider.decryptDataKey(envelope.encryptedDataKey, context);

  try {
    assertSupportedEnvelope(envelope);

    const decipher = createDecipheriv(
      dataEncryptionAlgorithm,
      plaintextKey,
      decodeBase64Url(envelope.iv, 'envelope.iv'),
    );
    const aad = encryptionContextToAad(context);

    decipher.setAAD(aad);
    decipher.setAuthTag(decodeBase64Url(envelope.tag, 'envelope.tag'));

    const plaintext = Buffer.concat([
      decipher.update(decodeBase64Url(envelope.ciphertext, 'envelope.ciphertext')),
      decipher.final(),
    ]);

    return plaintext.toString('utf8');
  } catch {
    throw new Error('Unable to decrypt secret envelope');
  } finally {
    plaintextKey.fill(0);
  }
}

function assertSupportedEnvelope(envelope: EncryptedSecretEnvelope): void {
  if (envelope.version !== encryptedSecretEnvelopeVersion) {
    throw new Error('Unsupported secret envelope version');
  }

  if (envelope.algorithm !== dataEncryptionAlgorithm) {
    throw new Error('Unsupported secret envelope algorithm');
  }
}
