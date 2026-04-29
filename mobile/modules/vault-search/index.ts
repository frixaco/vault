import VaultSearchModule from "./src/VaultSearchModule";
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
    throw new Error(envelope.error ?? "VaultSearch native call failed");
  }

  return envelope.value as T;
}

export async function initializeVaultSearch(options: VaultSearchInitOptions) {
  await VaultSearchModule.initialize(options.basePath, options.dataPath);
}

export function disposeVaultSearch() {
  VaultSearchModule.dispose();
}

export async function waitForVaultSearchScan(timeoutMs = 1000) {
  return VaultSearchModule.waitForScan(timeoutMs);
}

export async function getVaultSearchProgress(): Promise<SearchProgress> {
  return unwrapNativeJson(await VaultSearchModule.getProgressJson());
}

export async function searchVaultFiles(query: string, limit = 80): Promise<SearchFilesResponse> {
  return unwrapNativeJson(await VaultSearchModule.searchFilesJson(query, limit));
}

export { VaultSearchModule };
