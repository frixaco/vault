import { existsSync, readdirSync } from "node:fs";
import { mkdir } from "node:fs/promises";
import path from "node:path";
import koffi from "koffi";
import type {
  NoteContentSearchResponse,
  NoteSearchResponse,
  NoteTitleSearchResponse,
  SearchScope,
} from "./search-types.js";

type NativePointer = unknown;

type NativeEnvelope<T> = {
  error: string | null;
  ok: boolean;
  value: T | null;
};

type VaultSharedLibrary = {
  create: (basePath: string, dataPath: string) => NativePointer;
  destroy: (handle: NativePointer) => void;
  freeString: (value: NativePointer) => void;
  noteSearchJson: (handle: NativePointer, query: string, scope: SearchScope) => NativePointer;
  searchTrackSelectionJson: (
    handle: NativePointer,
    query: string,
    notePath: string,
  ) => NativePointer;
  takeLastError: () => NativePointer;
  unload: () => void;
  waitForScan: (handle: NativePointer, timeoutMs: number) => boolean;
};

export class VaultSharedNoteSearch {
  private handle: NativePointer | null = null;
  private initialized = false;
  private initializing: Promise<VaultSharedLibrary> | null = null;
  private library: VaultSharedLibrary | null = null;

  constructor(
    private readonly notesRoot: string,
    private readonly dataRoot: string,
  ) {}

  async search(query: string, scope: SearchScope = "all"): Promise<NoteSearchResponse> {
    return this.searchShared(query, scope);
  }

  async searchTitles(query: string): Promise<NoteTitleSearchResponse> {
    const response = await this.searchShared(query, "title");

    return {
      query: response.query,
      scope: response.scope,
      title: response.title,
    };
  }

  async searchContent(query: string): Promise<NoteContentSearchResponse> {
    const response = await this.searchShared(query, "content");

    return {
      content: response.content,
      query: response.query,
      scope: response.scope,
    };
  }

  async trackSelection(query: string, notePath: string) {
    if (!query.trim()) return;

    const library = await this.ensureInitialized();
    readNativeJson<null>(
      library,
      library.searchTrackSelectionJson(this.requireHandle(), query, notePath),
    );
  }

  dispose() {
    if (this.handle && this.library) {
      this.library.destroy(this.handle);
    }

    this.handle = null;
    this.initialized = false;
    this.library?.unload();
    this.library = null;
  }

  private async searchShared(query: string, scope: SearchScope) {
    const library = await this.ensureInitialized();

    return readNativeJson<NoteSearchResponse>(
      library,
      library.noteSearchJson(this.requireHandle(), query, scope),
    );
  }

  private async ensureInitialized() {
    if (this.initialized && this.library && this.handle) return this.library;
    if (this.initializing) return this.initializing;

    this.initializing = this.initialize();
    try {
      return await this.initializing;
    } finally {
      this.initializing = null;
    }
  }

  private async initialize() {
    if (this.initialized && this.library && this.handle) return this.library;

    await mkdir(this.dataRoot, { recursive: true });

    const library = loadVaultSharedLibrary();
    this.library = library;

    const handle = library.create(this.notesRoot, this.dataRoot);
    if (!handle || isNullPointer(handle)) {
      const lastErrorPointer = library.takeLastError();
      const lastError = takeCString(library, lastErrorPointer);
      library.unload();
      this.library = null;
      throw new Error(lastError ?? "vault-shared returned a null search handle");
    }

    this.handle = handle;
    this.initialized = true;
    library.waitForScan(this.requireHandle(), 1000);
    return library;
  }

  private requireHandle() {
    if (!this.handle) throw new Error("vault-shared search is not initialized");
    return this.handle;
  }
}

function loadVaultSharedLibrary(): VaultSharedLibrary {
  const libraryPath = findVaultSharedLibrary();
  if (!libraryPath) {
    throw new Error("vault-shared native library was not found");
  }

  const library = koffi.load(libraryPath);

  return {
    create: library.func(
      "void *vault_shared_search_create(str, str)",
    ) as VaultSharedLibrary["create"],
    destroy: library.func(
      "void vault_shared_search_destroy(void *handle)",
    ) as VaultSharedLibrary["destroy"],
    freeString: library.func(
      "void vault_shared_free_string(void *value)",
    ) as VaultSharedLibrary["freeString"],
    noteSearchJson: library.func(
      "void *vault_shared_note_search_json(void *handle, str, str)",
    ) as VaultSharedLibrary["noteSearchJson"],
    searchTrackSelectionJson: library.func(
      "void *vault_shared_search_track_selection_json(void *handle, str, str)",
    ) as VaultSharedLibrary["searchTrackSelectionJson"],
    takeLastError: library.func(
      "void *vault_shared_take_last_error()",
    ) as VaultSharedLibrary["takeLastError"],
    unload: () => library.unload(),
    waitForScan: library.func(
      "bool vault_shared_search_wait_for_scan(void *handle, uint64_t)",
    ) as VaultSharedLibrary["waitForScan"],
  };
}

function readNativeJson<T>(library: VaultSharedLibrary, pointer: NativePointer) {
  const json = takeCString(library, pointer);
  if (!json) throw new Error("vault-shared returned an empty response");

  const envelope = JSON.parse(json) as NativeEnvelope<T>;
  if (!envelope.ok) {
    throw new Error(envelope.error ?? "vault-shared native call failed");
  }

  return envelope.value as T;
}

function takeCString(library: VaultSharedLibrary, pointer: NativePointer | null) {
  if (!pointer || isNullPointer(pointer)) return null;

  try {
    return koffi.decode(pointer, "char", -1) as string;
  } finally {
    library.freeString(pointer);
  }
}

function findVaultSharedLibrary() {
  const filename = getVaultSharedLibraryFilename();
  const packagedLibrary = findPackagedVaultSharedLibrary(filename);
  if (packagedLibrary) return packagedLibrary;

  return findDevVaultSharedLibrary(filename) ?? findCargoVaultSharedLibrary(filename);
}

function findPackagedVaultSharedLibrary(filename: string) {
  const resourceRoot = (process as NodeJS.Process & { resourcesPath?: string }).resourcesPath;
  if (!resourceRoot || resourceRoot === process.cwd()) return null;

  return findFile(path.join(resourceRoot, "lib"), filename) ?? findFile(resourceRoot, filename);
}

function findDevVaultSharedLibrary(filename: string) {
  return findNearestFile(process.cwd(), path.join("build", "vault-shared", "lib", filename));
}

function findCargoVaultSharedLibrary(filename: string) {
  return findNearestFile(
    process.cwd(),
    path.join("..", "crates", "vault-shared", "target", "release", filename),
  );
}

function findNearestFile(startDirectory: string, relativePath: string) {
  let directory = startDirectory;

  while (true) {
    const candidate = path.resolve(directory, relativePath);
    if (existsSync(candidate)) return candidate;

    const parent = path.dirname(directory);
    if (parent === directory) return null;
    directory = parent;
  }
}

function findFile(directoryPath: string, filename: string): string | null {
  if (!existsSync(directoryPath)) return null;

  for (const entry of readdirSync(directoryPath, { withFileTypes: true })) {
    const entryPath = path.join(directoryPath, entry.name);
    if (entry.isFile() && entry.name === filename) return entryPath;
    if (entry.isDirectory()) {
      const found = findFile(entryPath, filename);
      if (found) return found;
    }
  }

  return null;
}

function getVaultSharedLibraryFilename() {
  if (process.platform === "win32") return "vault_shared_ffi.dll";
  if (process.platform === "darwin") return "libvault_shared_ffi.dylib";
  return "libvault_shared_ffi.so";
}

function isNullPointer(pointer: NativePointer) {
  try {
    return koffi.address(pointer) === 0n;
  } catch {
    return pointer === null || pointer === undefined;
  }
}
