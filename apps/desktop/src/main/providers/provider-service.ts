import {
  PROVIDER_CONTRACT_VERSION,
  isProviderConfigDeleteRequest,
  isProviderConfigInput,
  type ProviderConfig,
  type ProviderConfigDeleteRequest,
  type ProviderConfigInput,
  type ProviderConfigListResult,
  type ProviderDeleteResult,
  type ProviderHealth,
  type ProviderHealthErrorCode,
  type ProviderServiceKind,
  type ProviderAdapter,
  type ProviderRegistry,
  type ProviderTtsSynthesisResult,
  type TtsJobStartParams,
  type TtsStartRequest,
} from "@supervideo/shared";
import { isTtsStartRequest } from "@supervideo/shared";
import type { CredentialMetadata } from "@supervideo/shared";
import type { CredentialVault } from "../security/credential-vault";
import { ProviderConfigStore } from "./provider-config-store";

export class ProviderServiceError extends Error {
  constructor(readonly code: "PROVIDER_INVALID_CONFIG" | "PROVIDER_UNKNOWN" | "PROVIDER_CONFIG_NOT_FOUND" | "PROVIDER_CREDENTIAL_NOT_FOUND" | "PROVIDER_CREDENTIAL_KIND_MISMATCH" | "PROVIDER_HEALTH_TIMEOUT" | "PROVIDER_AUTH_FAILED" | "PROVIDER_UNAVAILABLE" | "PROVIDER_ADAPTER_FAILED" | "PROVIDER_REGISTRY_CONFLICT") { super(code); this.name = "ProviderServiceError"; }
}

export type ProviderRegistryEntry = ProviderAdapter;

export class InMemoryProviderRegistry implements ProviderRegistry {
  private readonly adapters = new Map<string, ProviderRegistryEntry>();
  register(adapter: ProviderRegistryEntry): void {
    const key = `${adapter.descriptor.serviceKind}:${adapter.descriptor.providerId}`;
    if (this.adapters.has(key)) throw new ProviderServiceError("PROVIDER_REGISTRY_CONFLICT");
    this.adapters.set(key, adapter);
  }
  get(providerId: string, serviceKind: ProviderServiceKind): ProviderRegistryEntry | undefined { return this.adapters.get(`${serviceKind}:${providerId}`); }
  list(): readonly ProviderRegistryEntry["descriptor"][] { return Object.freeze([...this.adapters.values()].map((entry) => entry.descriptor)); }
}

class FakeAdapter implements ProviderRegistryEntry {
  readonly descriptor: ProviderRegistryEntry["descriptor"];
  constructor(readonly serviceKind: ProviderServiceKind) {
    const capabilities: ProviderConfig["capabilities"] = serviceKind === "llm" ? ["chat.generate", "chat.stream"] : serviceKind === "tts" ? ["speech.synthesize"] : [serviceKind === "image" ? "image.generate" : "video.generate"];
    this.descriptor = Object.freeze({ providerId: "fake", serviceKind, capabilities: Object.freeze(capabilities) });
  }
  async health(_secret: string, config: ProviderConfig, timeoutMs: number): Promise<ProviderHealthErrorCode | null> {
    const code = config.model === "fake-fail" ? "NETWORK_ERROR" : config.model === "fake-auth" ? "AUTH_FAILED" : config.model === "fake-timeout" ? "TIMEOUT" : null;
    if (code === "TIMEOUT") await new Promise<void>((resolve) => setTimeout(resolve, timeoutMs + 10));
    else await new Promise<void>((resolve) => setTimeout(resolve, 5));
    return code;
  }
}

export function createDeterministicProviderRegistry(): InMemoryProviderRegistry {
  const registry = new InMemoryProviderRegistry();
  for (const kind of ["llm", "tts", "image", "video"] as const) registry.register(new FakeAdapter(kind));
  return registry;
}

/** Main-owned provider boundary. Config files contain only non-sensitive metadata. */
export class ProviderConfigService {
  constructor(private readonly vault: CredentialVault, private readonly store: ProviderConfigStore, private readonly registry: InMemoryProviderRegistry, private readonly now = Date.now) {}
  list(projectId: string): ProviderConfigListResult { return Object.freeze({ projectId, items: this.store.list(projectId) }); }
  async upsert(input: ProviderConfigInput): Promise<ProviderConfig> {
    if (!isProviderConfigInput(input)) throw new ProviderServiceError("PROVIDER_INVALID_CONFIG");
    const adapter = this.registry.get(input.providerId, input.serviceKind);
    if (!adapter) throw new ProviderServiceError("PROVIDER_UNKNOWN");
    const credential = input.credentialRef ? await this.findCredential(input.credentialRef) : undefined;
    if (input.credentialRef && !credential) throw new ProviderServiceError("PROVIDER_CREDENTIAL_NOT_FOUND");
    if (credential && (credential.providerId !== input.providerId || credential.serviceKind !== input.serviceKind)) throw new ProviderServiceError("PROVIDER_CREDENTIAL_KIND_MISMATCH");
    const current = this.store.get(input.projectId, input.serviceKind, input.providerId);
    const config: ProviderConfig = Object.freeze({ schemaVersion: 1, protocolVersion: PROVIDER_CONTRACT_VERSION, projectId: input.projectId, serviceKind: input.serviceKind, providerId: input.providerId, displayName: input.displayName, model: input.model, endpoint: input.endpoint ?? null, credentialRef: input.credentialRef ?? null, capabilities: Object.freeze([...adapter.descriptor.capabilities]), enabled: input.enabled ?? true, createdAtMs: current?.createdAtMs ?? this.now(), updatedAtMs: this.now() });
    return this.store.save(config);
  }
  async remove(input: ProviderConfigDeleteRequest): Promise<ProviderDeleteResult> {
    if (!isProviderConfigDeleteRequest(input)) throw new ProviderServiceError("PROVIDER_INVALID_CONFIG");
    return Object.freeze({ ...input, removed: await this.store.remove(input.projectId, input.serviceKind, input.providerId) });
  }
  async health(input: ProviderConfigDeleteRequest): Promise<ProviderHealth> {
    if (!isProviderConfigDeleteRequest(input)) throw new ProviderServiceError("PROVIDER_INVALID_CONFIG");
    const config = this.store.get(input.projectId, input.serviceKind, input.providerId);
    if (!config) throw new ProviderServiceError("PROVIDER_CONFIG_NOT_FOUND");
    const adapter = this.registry.get(config.providerId, config.serviceKind);
    if (!adapter) throw new ProviderServiceError("PROVIDER_UNKNOWN");
    const checkedAtMs = this.now(); const started = this.now(); let code: ProviderHealthErrorCode | null = null;
    if (!config.credentialRef) code = "MISSING_CREDENTIAL";
    else { try { code = await Promise.race([this.vault.runWithSecret(config.credentialRef, (secret) => adapter.health(secret, config, 500)), new Promise<ProviderHealthErrorCode>((resolve) => setTimeout(() => resolve("TIMEOUT"), 500))]); } catch { code = "CREDENTIAL_UNAVAILABLE"; } }
    return Object.freeze({ schemaVersion: 1, protocolVersion: PROVIDER_CONTRACT_VERSION, projectId: config.projectId, serviceKind: config.serviceKind, providerId: config.providerId, status: code === null ? "healthy" : code === "MISSING_CREDENTIAL" ? "unconfigured" : "unhealthy", capabilities: config.capabilities, checkedAtMs, latencyMs: Math.max(0, this.now() - started), error: code === null ? null : Object.freeze({ code, retryable: code === "TIMEOUT" || code === "NETWORK_ERROR" }) });
  }
  /**
   * Resolve D02's non-sensitive provider selection in Main. The credentialRef
   * is inspected here only; it is deliberately omitted from the Core job
   * payload. A future real adapter may use it through CredentialVault.runWithSecret.
   */
  async resolveTts(input: TtsStartRequest): Promise<TtsJobStartParams> {
    if (!isTtsStartRequest(input)) throw new ProviderServiceError("PROVIDER_INVALID_CONFIG");
    const config = this.store.get(input.projectId, "tts", input.providerId);
    if (!config || !config.enabled || !config.capabilities.includes("speech.synthesize")) throw new ProviderServiceError("PROVIDER_UNAVAILABLE");
    if (config.credentialRef) {
      const credential = await this.findCredential(config.credentialRef);
      if (!credential) throw new ProviderServiceError("PROVIDER_CREDENTIAL_NOT_FOUND");
      if (credential.providerId !== config.providerId || credential.serviceKind !== "tts") throw new ProviderServiceError("PROVIDER_CREDENTIAL_KIND_MISMATCH");
    } else if (config.providerId !== "fake") {
      throw new ProviderServiceError("PROVIDER_UNAVAILABLE");
    }
    return Object.freeze({ ...input, model: config.model });
  }
  /**
   * Main-only future real-provider seam. The adapter receives the decrypted
   * secret only inside CredentialVault.runWithSecret; the request and result
   * contain no credentialRef, secret, or ciphertext.
   */
  async synthesizeTts(input: TtsStartRequest): Promise<ProviderTtsSynthesisResult> {
    const resolved = await this.resolveTts(input);
    const config = this.store.get(input.projectId, "tts", input.providerId);
    const adapter = this.registry.get(input.providerId, "tts");
    if (!config?.credentialRef || !adapter?.synthesizeTts) throw new ProviderServiceError("PROVIDER_UNAVAILABLE");
    const request = Object.freeze({
      projectId: resolved.projectId,
      model: resolved.model,
      voice: resolved.voice,
      sentences: Object.freeze(resolved.sentences.map((sentence) => Object.freeze({
        sentenceId: sentence.sentenceId,
        text: sentence.text,
        provenanceIds: Object.freeze([...(sentence.provenanceIds ?? [])]),
      }))),
    });
    return this.vault.runWithSecret(config.credentialRef, (secret) => adapter.synthesizeTts!(secret, request, 30_000));
  }
  descriptors(): readonly ProviderRegistryEntry["descriptor"][] { return this.registry.list(); }
  private async findCredential(ref: string): Promise<CredentialMetadata | undefined> { return (await this.vault.list()).items.find((item) => item.credentialRef === ref); }
}
