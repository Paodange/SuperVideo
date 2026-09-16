import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import {
  CREDENTIAL_MAX_CIPHERTEXT_BYTES,
  CREDENTIAL_MAX_ITEMS,
  CREDENTIAL_STORE_SCHEMA_VERSION,
  createDesktopPublicError,
  isCredentialRemoveRequest,
  isCredentialSaveRequest,
  isCredentialReplaceRequest,
  isCredentialMetadata,
  isCredentialStorageStatus,
  type CredentialMetadata,
  type CredentialRemoveRequest,
  type CredentialRemoveResult,
  type CredentialReplaceRequest,
  type CredentialSaveRequest,
  type CredentialStorageStatus,
} from "@supervideo/shared";

export type CredentialEncryptionAdapter = Readonly<{
  isEncryptionAvailable: () => boolean;
  encryptString: (value: string) => Buffer;
  decryptString: (value: Buffer) => string;
}>;

type StoredCredential = CredentialMetadata & Readonly<{ encryptedValueBase64: string }>;
type CredentialStore = Readonly<{ schemaVersion: typeof CREDENTIAL_STORE_SCHEMA_VERSION; credentials: readonly StoredCredential[] }>;

export class CredentialVaultError extends Error {
  readonly publicError: ReturnType<typeof createDesktopPublicError>;

  constructor(readonly code: "CREDENTIAL_STORAGE_UNAVAILABLE" | "CREDENTIAL_STORE_CORRUPT" | "CREDENTIAL_NOT_FOUND" | "INVALID_CREDENTIAL_INPUT" | "CREDENTIAL_WRITE_FAILED") {
    super(createDesktopPublicError(code).message);
    this.name = "CredentialVaultError";
    this.publicError = createDesktopPublicError(code);
  }
}

export type CredentialVaultOptions = Readonly<{
  filePath: string;
  encryption: CredentialEncryptionAdapter;
  now?: () => number;
  createId?: () => string;
}>;

/**
 * Main-owned, non-exporting credential vault. The only value crossing back to
 * Renderer is metadata; decryptString is intentionally private to this class.
 */
export class CredentialVault {
  private readonly filePath: string;
  private readonly encryption: CredentialEncryptionAdapter;
  private readonly now: () => number;
  private readonly createId: () => string;
  private mutationQueue: Promise<void> = Promise.resolve();

  constructor(options: CredentialVaultOptions) {
    if (!path.isAbsolute(options.filePath)) throw new Error("Credential vault file path must be absolute.");
    this.filePath = path.normalize(options.filePath);
    this.encryption = options.encryption;
    this.now = options.now ?? Date.now;
    this.createId = options.createId ?? (() => `cred-${crypto.randomUUID()}`);
  }

  get storagePath(): string {
    return this.filePath;
  }

  status(): CredentialStorageStatus {
    let available = false;
    try {
      available = this.encryption.isEncryptionAvailable() === true;
    } catch {
      return { available: false, state: "unavailable" };
    }
    if (!available) return { available: false, state: "unavailable" };
    try {
      this.readStore();
      return { available: true, state: "available" };
    } catch (error) {
      if (error instanceof CredentialVaultError && error.code === "CREDENTIAL_STORE_CORRUPT") return { available: true, state: "corrupt" };
      return { available: true, state: "available" };
    }
  }

  async list(): Promise<Readonly<{ items: readonly CredentialMetadata[] }>> {
    return this.withAvailable(() => {
      const store = this.readStore();
      return Object.freeze({ items: Object.freeze(store.credentials.map(toMetadata)) });
    });
  }

  async save(input: CredentialSaveRequest): Promise<CredentialMetadata> {
    if (!isCredentialSaveRequest(input)) throw new CredentialVaultError("INVALID_CREDENTIAL_INPUT");
    return this.mutate(async () => {
      this.requireAvailable();
      const store = this.readStore();
      if (store.credentials.length >= CREDENTIAL_MAX_ITEMS) throw new CredentialVaultError("CREDENTIAL_WRITE_FAILED");
      const now = this.now();
      const metadata: CredentialMetadata = Object.freeze({
        credentialRef: this.newCredentialRef(store),
        serviceKind: input.serviceKind,
        providerId: input.providerId,
        displayName: input.displayName.trim(),
        configured: true,
        createdAtMs: now,
        updatedAtMs: now,
      });
      const stored = this.encrypt(metadata, input.secret);
      await this.writeStore(Object.freeze({ schemaVersion: CREDENTIAL_STORE_SCHEMA_VERSION, credentials: Object.freeze([...store.credentials, stored]) }));
      return metadata;
    });
  }

  async replace(input: CredentialReplaceRequest): Promise<CredentialMetadata> {
    if (!isCredentialReplaceRequest(input)) throw new CredentialVaultError("INVALID_CREDENTIAL_INPUT");
    return this.mutate(async () => {
      this.requireAvailable();
      const store = this.readStore();
      const index = store.credentials.findIndex((item) => item.credentialRef === input.credentialRef);
      if (index < 0) throw new CredentialVaultError("CREDENTIAL_NOT_FOUND");
      const current = store.credentials[index]!;
      const metadata: CredentialMetadata = Object.freeze({
        credentialRef: current.credentialRef,
        serviceKind: current.serviceKind,
        providerId: current.providerId,
        displayName: current.displayName,
        configured: true,
        createdAtMs: current.createdAtMs,
        updatedAtMs: this.now(),
      });
      const replacement = this.encrypt(metadata, input.secret);
      const credentials = [...store.credentials];
      credentials[index] = replacement;
      await this.writeStore(Object.freeze({ schemaVersion: CREDENTIAL_STORE_SCHEMA_VERSION, credentials: Object.freeze(credentials) }));
      return metadata;
    });
  }

  async remove(input: CredentialRemoveRequest): Promise<CredentialRemoveResult> {
    if (!isCredentialRemoveRequest(input)) throw new CredentialVaultError("INVALID_CREDENTIAL_INPUT");
    return this.mutate(async () => {
      this.requireAvailable();
      const store = this.readStore();
      const index = store.credentials.findIndex((item) => item.credentialRef === input.credentialRef);
      if (index < 0) return Object.freeze({ removed: false });
      const credentials = store.credentials.filter((item) => item.credentialRef !== input.credentialRef);
      await this.writeStore(Object.freeze({ schemaVersion: CREDENTIAL_STORE_SCHEMA_VERSION, credentials: Object.freeze(credentials) }));
      return Object.freeze({ removed: true });
    });
  }

  private async mutate<T>(operation: () => Promise<T>): Promise<T> {
    const result = this.mutationQueue.then(operation, operation);
    this.mutationQueue = result.then(() => undefined, () => undefined);
    return result;
  }

  private async withAvailable<T>(operation: () => T): Promise<T> {
    this.requireAvailable();
    return operation();
  }

  private requireAvailable(): void {
    try {
      if (!this.encryption.isEncryptionAvailable()) throw new CredentialVaultError("CREDENTIAL_STORAGE_UNAVAILABLE");
    } catch (error) {
      if (error instanceof CredentialVaultError) throw error;
      throw new CredentialVaultError("CREDENTIAL_STORAGE_UNAVAILABLE");
    }
  }

  private readStore(): CredentialStore {
    let bytes: Buffer;
    try {
      const info = fs.lstatSync(this.filePath);
      if (!info.isFile() || info.size > 1 * 1024 * 1024) throw new Error("invalid file");
      bytes = fs.readFileSync(this.filePath);
    } catch (error) {
      const code = error && typeof error === "object" && "code" in error ? error.code : undefined;
      if (code === "ENOENT") return { schemaVersion: CREDENTIAL_STORE_SCHEMA_VERSION, credentials: [] };
      throw new CredentialVaultError("CREDENTIAL_STORE_CORRUPT");
    }
    let value: unknown;
    try {
      value = JSON.parse(bytes.toString("utf8"));
    } catch {
      throw new CredentialVaultError("CREDENTIAL_STORE_CORRUPT");
    }
    if (!isPlainRecord(value) || !hasExactKeys(value, ["schemaVersion", "credentials"]) || value.schemaVersion !== CREDENTIAL_STORE_SCHEMA_VERSION || !Array.isArray(value.credentials) || value.credentials.length > CREDENTIAL_MAX_ITEMS) {
      throw new CredentialVaultError("CREDENTIAL_STORE_CORRUPT");
    }
    const credentials: StoredCredential[] = [];
    const refs = new Set<string>();
    for (const item of value.credentials) {
      if (!isStoredCredential(item) || refs.has(item.credentialRef)) throw new CredentialVaultError("CREDENTIAL_STORE_CORRUPT");
      refs.add(item.credentialRef);
      try {
        const encrypted = Buffer.from(item.encryptedValueBase64, "base64");
        this.encryption.decryptString(encrypted);
      } catch {
        throw new CredentialVaultError("CREDENTIAL_STORE_CORRUPT");
      }
      credentials.push(item);
    }
    return Object.freeze({ schemaVersion: CREDENTIAL_STORE_SCHEMA_VERSION, credentials: Object.freeze(credentials) });
  }

  private encrypt(metadata: CredentialMetadata, secret: string): StoredCredential {
    try {
      const encrypted = this.encryption.encryptString(secret);
      if (!Buffer.isBuffer(encrypted) || encrypted.length === 0 || encrypted.length > CREDENTIAL_MAX_CIPHERTEXT_BYTES) throw new Error("invalid ciphertext");
      return Object.freeze({ ...metadata, encryptedValueBase64: encrypted.toString("base64") });
    } catch (error) {
      if (error instanceof CredentialVaultError) throw error;
      throw new CredentialVaultError("CREDENTIAL_WRITE_FAILED");
    }
  }

  private async writeStore(store: CredentialStore): Promise<void> {
    const directory = path.dirname(this.filePath);
    const temporaryPath = path.join(directory, `.credentials.${process.pid}.${crypto.randomUUID()}.tmp`);
    const payload = `${JSON.stringify(store, null, 2)}\n`;
    let handle: number | undefined;
    try {
      fs.mkdirSync(directory, { recursive: true });
      handle = fs.openSync(temporaryPath, "wx");
      fs.writeFileSync(handle, payload, { encoding: "utf8" });
      fs.fsyncSync(handle);
      fs.closeSync(handle);
      handle = undefined;
      fs.renameSync(temporaryPath, this.filePath);
    } catch {
      if (handle !== undefined) {
        try { fs.closeSync(handle); } catch { /* best effort cleanup */ }
      }
      try { fs.unlinkSync(temporaryPath); } catch { /* the old store remains authoritative */ }
      throw new CredentialVaultError("CREDENTIAL_WRITE_FAILED");
    }
  }

  private newCredentialRef(store: CredentialStore): string {
    for (let attempt = 0; attempt < 8; attempt += 1) {
      const candidate = this.createId();
      if (isCredentialMetadata({ credentialRef: candidate, serviceKind: "llm", providerId: "x", displayName: "x", configured: true, createdAtMs: 0, updatedAtMs: 0 }) && !store.credentials.some((item) => item.credentialRef === candidate)) return candidate;
    }
    throw new CredentialVaultError("CREDENTIAL_WRITE_FAILED");
  }
}

function toMetadata(value: StoredCredential): CredentialMetadata {
  const { encryptedValueBase64: _encrypted, ...metadata } = value;
  return Object.freeze(metadata);
}

function isStoredCredential(value: unknown): value is StoredCredential {
  if (!isPlainRecord(value) || !hasExactKeys(value, ["credentialRef", "serviceKind", "providerId", "displayName", "configured", "createdAtMs", "updatedAtMs", "encryptedValueBase64"])) return false;
  if (!isCredentialMetadata({
    credentialRef: value.credentialRef,
    serviceKind: value.serviceKind,
    providerId: value.providerId,
    displayName: value.displayName,
    configured: value.configured,
    createdAtMs: value.createdAtMs,
    updatedAtMs: value.updatedAtMs,
  })) return false;
  if (typeof value.encryptedValueBase64 !== "string" || value.encryptedValueBase64.length === 0 || value.encryptedValueBase64.length > CREDENTIAL_MAX_CIPHERTEXT_BYTES * 2 || value.encryptedValueBase64.length % 4 !== 0 || !/^[A-Za-z0-9+/]+={0,2}$/.test(value.encryptedValueBase64)) return false;
  let decoded: Buffer;
  try { decoded = Buffer.from(value.encryptedValueBase64, "base64"); } catch { return false; }
  return decoded.length > 0 && decoded.length <= CREDENTIAL_MAX_CIPHERTEXT_BYTES && decoded.toString("base64") === value.encryptedValueBase64;
}

function isPlainRecord(value: unknown): value is Record<string, any> {
  return value !== null && typeof value === "object" && !Array.isArray(value) && Object.getPrototypeOf(value) === Object.prototype;
}

function hasExactKeys(value: Record<string, unknown>, keys: readonly string[]): boolean {
  return Object.keys(value).length === keys.length && keys.every((key) => Object.prototype.hasOwnProperty.call(value, key));
}

export function createElectronCredentialEncryptionAdapter(safeStorage: Readonly<{
  isEncryptionAvailable: () => boolean;
  encryptString: (value: string) => Buffer;
  decryptString: (value: Buffer) => string;
}>): CredentialEncryptionAdapter {
  return Object.freeze({
    isEncryptionAvailable: () => safeStorage.isEncryptionAvailable(),
    encryptString: (value: string) => safeStorage.encryptString(value),
    decryptString: (value: Buffer) => safeStorage.decryptString(value),
  });
}

export function isCredentialVaultStatus(value: unknown): value is CredentialStorageStatus {
  return isCredentialStorageStatus(value);
}
