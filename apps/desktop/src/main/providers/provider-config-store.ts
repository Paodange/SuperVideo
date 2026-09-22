import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { PROVIDER_CONFIG_SCHEMA_VERSION, PROVIDER_MAX_CONFIGS_PER_PROJECT, isProviderConfig, type ProviderConfig, type ProviderServiceKind } from "@supervideo/shared";

export class ProviderConfigStoreError extends Error {
  constructor(readonly code: "PROVIDER_CONFIG_CORRUPT" | "PROVIDER_CONFIG_WRITE_FAILED") { super(code); this.name = "ProviderConfigStoreError"; }
}

/** Main-owned, non-secret metadata store; it is not a credential vault. */
export class ProviderConfigStore {
  private mutationQueue: Promise<void> = Promise.resolve();
  constructor(private readonly filePath: string) { if (!path.isAbsolute(filePath)) throw new Error("provider config path must be absolute"); }
  list(projectId: string): readonly ProviderConfig[] { return Object.freeze(this.read().filter((item) => item.projectId === projectId)); }
  get(projectId: string, serviceKind: ProviderServiceKind, providerId: string): ProviderConfig | undefined { return this.read().find((item) => item.projectId === projectId && item.serviceKind === serviceKind && item.providerId === providerId); }
  async save(config: ProviderConfig): Promise<ProviderConfig> {
    if (!isProviderConfig(config)) throw new ProviderConfigStoreError("PROVIDER_CONFIG_CORRUPT");
    return this.mutate(async () => { const current = this.read(); const index = current.findIndex((item) => item.projectId === config.projectId && item.serviceKind === config.serviceKind && item.providerId === config.providerId); if (index < 0 && current.filter((item) => item.projectId === config.projectId).length >= PROVIDER_MAX_CONFIGS_PER_PROJECT) throw new ProviderConfigStoreError("PROVIDER_CONFIG_WRITE_FAILED"); const next = [...current]; if (index < 0) next.push(config); else next[index] = config; await this.write(next); return config; });
  }
  async remove(projectId: string, serviceKind: ProviderServiceKind, providerId: string): Promise<boolean> { return this.mutate(async () => { const current = this.read(); const next = current.filter((item) => !(item.projectId === projectId && item.serviceKind === serviceKind && item.providerId === providerId)); if (next.length === current.length) return false; await this.write(next); return true; }); }
  private async mutate<T>(operation: () => Promise<T>): Promise<T> { const result = this.mutationQueue.then(operation, operation); this.mutationQueue = result.then(() => undefined, () => undefined); return result; }
  private read(): ProviderConfig[] { let value: unknown; try { const info = fs.lstatSync(this.filePath); if (!info.isFile() || info.size > 2 * 1024 * 1024) throw new Error("invalid file"); value = JSON.parse(fs.readFileSync(this.filePath, "utf8")); } catch (error) { if (error && typeof error === "object" && "code" in error && error.code === "ENOENT") return []; throw new ProviderConfigStoreError("PROVIDER_CONFIG_CORRUPT"); } if (!isRecord(value) || Object.keys(value).length !== 2 || value.schemaVersion !== PROVIDER_CONFIG_SCHEMA_VERSION || !Array.isArray(value.configs) || value.configs.length > 1_000 || !value.configs.every(isProviderConfig)) throw new ProviderConfigStoreError("PROVIDER_CONFIG_CORRUPT"); const keys = new Set<string>(); for (const config of value.configs) { const key = `${config.projectId}:${config.serviceKind}:${config.providerId}`; if (keys.has(key)) throw new ProviderConfigStoreError("PROVIDER_CONFIG_CORRUPT"); keys.add(key); } return value.configs.map((config) => Object.freeze({ ...config, capabilities: Object.freeze([...config.capabilities]) })); }
  private async write(configs: readonly ProviderConfig[]): Promise<void> { const directory = path.dirname(this.filePath); const temporary = path.join(directory, `.providers.${process.pid}.${crypto.randomUUID()}.tmp`); let handle: number | undefined; try { fs.mkdirSync(directory, { recursive: true }); handle = fs.openSync(temporary, "wx"); fs.writeFileSync(handle, `${JSON.stringify({ schemaVersion: PROVIDER_CONFIG_SCHEMA_VERSION, configs }, null, 2)}\n`, "utf8"); fs.fsyncSync(handle); fs.closeSync(handle); handle = undefined; fs.renameSync(temporary, this.filePath); } catch { if (handle !== undefined) { try { fs.closeSync(handle); } catch { /* best effort */ } } try { fs.unlinkSync(temporary); } catch { /* preserve old file */ } throw new ProviderConfigStoreError("PROVIDER_CONFIG_WRITE_FAILED"); } }
}
function isRecord(value: unknown): value is Record<string, any> { return value !== null && typeof value === "object" && !Array.isArray(value) && Object.getPrototypeOf(value) === Object.prototype; }
