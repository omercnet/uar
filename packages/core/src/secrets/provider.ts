import { createCipheriv, createDecipheriv, randomBytes as nodeRandomBytes } from 'node:crypto';

export const dataEncryptionAlgorithm = 'aes-256-gcm' as const;
export const encryptedDataKeyVersion = 1 as const;
export const localKmsMasterKeyEnvName = 'UAR_LOCAL_KMS_MASTER_KEY';

const aes256KeyBytes = 32;
const gcmIvBytes = 12;

export type EncryptionContext = Readonly<Record<string, string>>;

export type EncryptedDataKey = {
  readonly version: typeof encryptedDataKeyVersion;
  readonly keyId: string;
  readonly algorithm: typeof dataEncryptionAlgorithm;
  readonly iv: string;
  readonly ciphertext: string;
  readonly tag: string;
};

export type GeneratedDataKey = {
  readonly plaintextKey: Uint8Array;
  readonly encryptedDataKey: EncryptedDataKey;
};

export interface KeyEncryptionProvider {
  generateDataKey(context?: EncryptionContext): Promise<GeneratedDataKey>;
  encryptDataKey(plaintextKey: Uint8Array, context?: EncryptionContext): Promise<EncryptedDataKey>;
  decryptDataKey(encryptedDataKey: EncryptedDataKey, context?: EncryptionContext): Promise<Uint8Array>;
}

export type RandomBytes = (byteLength: number) => Uint8Array;

export type LocalKeyEncryptionProviderOptions = {
  readonly keyId?: string;
  readonly masterKey: string | Uint8Array;
  readonly randomBytes?: RandomBytes;
};

export type LocalKeyEncryptionProviderFromEnvOptions = {
  readonly keyId?: string;
  readonly variableName?: string;
  readonly env?: NodeJS.ProcessEnv;
  readonly randomBytes?: RandomBytes;
};

export function encodeBase64Url(value: Uint8Array): string {
  return Buffer.from(value).toString('base64url');
}

export function decodeBase64Url(value: string, fieldName: string): Buffer {
  if (value.length === 0) {
    throw new Error(`${fieldName} must not be empty`);
  }

  return Buffer.from(value, 'base64url');
}

export function encryptionContextToAad(context?: EncryptionContext): Buffer {
  if (context === undefined) {
    return Buffer.alloc(0);
  }

  const normalizedContext = Object.entries(context).sort(([leftKey], [rightKey]) =>
    leftKey.localeCompare(rightKey),
  );

  return Buffer.from(JSON.stringify(normalizedContext), 'utf8');
}

export function createLocalKeyEncryptionProvider(
  options: LocalKeyEncryptionProviderOptions,
): KeyEncryptionProvider {
  return new LocalKeyEncryptionProvider(
    options.keyId ?? 'local-dev',
    normalizeAes256Key(options.masterKey, 'masterKey'),
    options.randomBytes ?? nodeRandomBytes,
  );
}

export function createLocalKeyEncryptionProviderFromEnv(
  options: LocalKeyEncryptionProviderFromEnvOptions = {},
): KeyEncryptionProvider {
  const variableName = options.variableName ?? localKmsMasterKeyEnvName;
  const env = options.env ?? process.env;
  const masterKey = env[variableName];

  if (masterKey === undefined || masterKey.trim().length === 0) {
    throw new Error(`${variableName} must be configured for local secrets encryption`);
  }

  return createLocalKeyEncryptionProvider({
    keyId: options.keyId ?? `env:${variableName}`,
    masterKey,
    randomBytes: options.randomBytes,
  });
}

class LocalKeyEncryptionProvider implements KeyEncryptionProvider {
  constructor(
    private readonly keyId: string,
    private readonly masterKey: Buffer,
    private readonly randomBytes: RandomBytes,
  ) {}

  async generateDataKey(context?: EncryptionContext): Promise<GeneratedDataKey> {
    const plaintextKey = Buffer.from(this.randomBytes(aes256KeyBytes));
    const encryptedDataKey = await this.encryptDataKey(plaintextKey, context);

    return { plaintextKey, encryptedDataKey };
  }

  async encryptDataKey(
    plaintextKey: Uint8Array,
    context?: EncryptionContext,
  ): Promise<EncryptedDataKey> {
    const normalizedPlaintextKey = normalizeAes256Key(plaintextKey, 'plaintextKey');
    const iv = Buffer.from(this.randomBytes(gcmIvBytes));
    const cipher = createCipheriv(dataEncryptionAlgorithm, this.masterKey, iv);
    const aad = encryptionContextToAad(context);

    cipher.setAAD(aad);

    const ciphertext = Buffer.concat([cipher.update(normalizedPlaintextKey), cipher.final()]);

    return {
      version: encryptedDataKeyVersion,
      keyId: this.keyId,
      algorithm: dataEncryptionAlgorithm,
      iv: encodeBase64Url(iv),
      ciphertext: encodeBase64Url(ciphertext),
      tag: encodeBase64Url(cipher.getAuthTag()),
    };
  }

  async decryptDataKey(
    encryptedDataKey: EncryptedDataKey,
    context?: EncryptionContext,
  ): Promise<Uint8Array> {
    if (encryptedDataKey.version !== encryptedDataKeyVersion) {
      throw new Error('Unable to decrypt data key: unsupported envelope version');
    }

    if (encryptedDataKey.algorithm !== dataEncryptionAlgorithm) {
      throw new Error('Unable to decrypt data key: unsupported algorithm');
    }

    if (encryptedDataKey.keyId !== this.keyId) {
      throw new Error('Unable to decrypt data key: key id mismatch');
    }

    try {
      const decipher = createDecipheriv(
        dataEncryptionAlgorithm,
        this.masterKey,
        decodeBase64Url(encryptedDataKey.iv, 'encryptedDataKey.iv'),
      );
      const aad = encryptionContextToAad(context);

      decipher.setAAD(aad);
      decipher.setAuthTag(decodeBase64Url(encryptedDataKey.tag, 'encryptedDataKey.tag'));

      const plaintextKey = Buffer.concat([
        decipher.update(decodeBase64Url(encryptedDataKey.ciphertext, 'encryptedDataKey.ciphertext')),
        decipher.final(),
      ]);

      return normalizeAes256Key(plaintextKey, 'plaintextKey');
    } catch {
      throw new Error('Unable to decrypt data key');
    }
  }
}

function normalizeAes256Key(keyMaterial: string | Uint8Array, fieldName: string): Buffer {
  const key = typeof keyMaterial === 'string' ? decodeKeyMaterial(keyMaterial, fieldName) : Buffer.from(keyMaterial);

  if (key.byteLength !== aes256KeyBytes) {
    throw new Error(`${fieldName} must be ${aes256KeyBytes} bytes for AES-256-GCM`);
  }

  return Buffer.from(key);
}

function decodeKeyMaterial(keyMaterial: string, fieldName: string): Buffer {
  const trimmedKeyMaterial = keyMaterial.trim();

  if (trimmedKeyMaterial.startsWith('base64:')) {
    return Buffer.from(trimmedKeyMaterial.slice('base64:'.length), 'base64');
  }

  if (trimmedKeyMaterial.startsWith('base64url:')) {
    return Buffer.from(trimmedKeyMaterial.slice('base64url:'.length), 'base64url');
  }

  if (trimmedKeyMaterial.startsWith('hex:')) {
    return Buffer.from(trimmedKeyMaterial.slice('hex:'.length), 'hex');
  }

  if (/^[0-9a-f]{64}$/iu.test(trimmedKeyMaterial)) {
    return Buffer.from(trimmedKeyMaterial, 'hex');
  }

  const decoded = Buffer.from(trimmedKeyMaterial, 'base64url');

  if (decoded.byteLength === aes256KeyBytes) {
    return decoded;
  }

  throw new Error(`${fieldName} must be base64url, base64:<value>, base64url:<value>, or hex:<value>`);
}
