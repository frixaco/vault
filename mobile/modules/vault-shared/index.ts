import VaultSharedModule from "./src/VaultSharedModule";
import type {
  NativeEnvelope,
  NoteSearchResponse,
  SearchFilesResponse,
  SearchProgress,
  SearchScope,
  VaultSearchInitOptions,
} from "./src/VaultSearch.types";

export type {
  ContentSearchResult,
  NoteSearchResponse,
  NoteSearchResult,
  SearchFile,
  SearchFilesResponse,
  SearchJump,
  SearchProgress,
  SearchScope,
  TitleSearchResult,
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

export async function searchVaultNotes(
  query: string,
  scope: SearchScope = "all",
): Promise<NoteSearchResponse> {
  return unwrapNativeJson(await VaultSharedModule.noteSearchJson(query, scope));
}

export async function trackVaultSearchSelection(query: string, notePath: string) {
  return unwrapNativeJson(await VaultSharedModule.searchTrackSelectionJson(query, notePath));
}

const VaultSearchModule = VaultSharedModule;

export { VaultSearchModule, VaultSharedModule };
