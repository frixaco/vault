import VaultSharedModule from "./src/VaultSharedModule";
import type {
  NativeEnvelope,
  SearchFilesResponse,
  SearchProgress,
  VaultSearchInitOptions,
} from "./src/VaultSearch.types";

export type {
  SearchFile,
  SearchFilesResponse,
  SearchProgress,
  VaultSearchInitOptions,
} from "./src/VaultSearch.types";

function unwrapNativeJson<T>(json: string): T {
  const envelope = JSON.parse(json) as NativeEnvelope<T>;
  if (!envelope.ok) {
    throw new Error(envelope.error ?? "VaultShared native call failed");
  }

  return envelope.value as T;
}

export async function initializeVaultSearch(options: VaultSearchInitOptions) {
  await VaultSharedModule.initialize(options.basePath, options.dataPath);
}

export function disposeVaultSearch() {
  VaultSharedModule.dispose();
}

export async function waitForVaultSearchScan(timeoutMs = 1000) {
  return VaultSharedModule.waitForScan(timeoutMs);
}

export async function getVaultSearchProgress(): Promise<SearchProgress> {
  return unwrapNativeJson(await VaultSharedModule.getProgressJson());
}

export async function searchVaultFiles(query: string, limit = 80): Promise<SearchFilesResponse> {
  return unwrapNativeJson(await VaultSharedModule.searchFilesJson(query, limit));
}

const VaultSearchModule = VaultSharedModule;

export { VaultSearchModule, VaultSharedModule };
