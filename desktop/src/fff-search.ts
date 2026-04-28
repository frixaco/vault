import { existsSync, readdirSync } from "node:fs";
import { mkdir } from "node:fs/promises";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";
import koffi from "koffi";
import type {
  ContentSearchResult,
  NoteContentSearchResponse,
  NoteSearchResponse,
  NoteTitleSearchResponse,
  SearchScope,
  TitleSearchResult,
} from "./search-types.js";

type NativePointer = unknown;

type FffResult = {
  error: NativePointer | null;
  handle: NativePointer | null;
  int_value: bigint | number;
  success: boolean;
};

type FffSearchResult = {
  count: number;
  total_files: number;
  total_matched: number;
};

type FffGrepResult = {
  count: number;
  filtered_file_count: number;
  next_file_offset: number;
  regex_fallback_error: NativePointer | null;
  total_files: number;
  total_files_searched: number;
  total_matched: number;
};

type FffGrepMatch = {
  byte_offset: bigint | number;
  col: number;
  context_after: NativePointer | null;
  context_after_count: number;
  context_before: NativePointer | null;
  context_before_count: number;
  file_name: NativePointer | null;
  fuzzy_score: number;
  git_status: NativePointer | null;
  has_fuzzy_score: boolean;
  is_binary: boolean;
  is_definition: boolean;
  line_content: NativePointer | null;
  line_number: bigint | number;
  match_ranges: NativePointer | null;
  match_ranges_count: number;
  modified: bigint | number;
  relative_path: NativePointer | null;
  size: bigint | number;
  total_frecency_score: bigint | number;
  access_frecency_score: bigint | number;
  modification_frecency_score: bigint | number;
};

type FffLibrary = {
  createInstance: (...args: unknown[]) => NativePointer;
  destroy: (handle: NativePointer) => void;
  fileItemRelativePath: (item: NativePointer) => string | null;
  freeResult: (result: NativePointer) => void;
  freeGrepResult: (result: NativePointer) => void;
  freeSearchResult: (result: NativePointer) => void;
  grep: (
    handle: NativePointer,
    query: string,
    mode: number,
    maxFileSize: number,
    maxMatchesPerFile: number,
    smartCase: boolean,
    fileOffset: number,
    pageLimit: number,
    timeBudgetMs: number,
    beforeContext: number,
    afterContext: number,
    classifyDefinitions: boolean,
  ) => NativePointer;
  grepResultMatch: (result: NativePointer, index: number) => NativePointer;
  search: (
    handle: NativePointer,
    query: string,
    currentFile: string,
    maxThreads: number,
    pageIndex: number,
    pageSize: number,
    comboBoostMultiplier: number,
    minComboCount: number,
  ) => NativePointer;
  searchResultItem: (result: NativePointer, index: number) => NativePointer;
  trackQuery: (handle: NativePointer, query: string, filePath: string) => NativePointer;
  unload: () => void;
  waitForScan: (handle: NativePointer, timeoutMs: number) => NativePointer;
};

const SEARCH_PAGE_SIZE = 120;
const SEARCH_RESULT_LIMIT = 80;
const CONTENT_RESULT_LIMIT = 24;
const MAX_SEARCH_PAGES = 4;

const FFF_RESULT = koffi.struct("FffResult", {
  success: "bool",
  error: "void *",
  handle: "void *",
  int_value: "int64_t",
});

const FFF_SEARCH_RESULT = koffi.struct("FffSearchResult", {
  items: "void *",
  scores: "void *",
  count: "uint32_t",
  total_matched: "uint32_t",
  total_files: "uint32_t",
  location_tag: "uint8_t",
  location_line: "int32_t",
  location_col: "int32_t",
  location_end_line: "int32_t",
  location_end_col: "int32_t",
});

const FFF_GREP_RESULT = koffi.struct("FffGrepResult", {
  items: "void *",
  count: "uint32_t",
  total_matched: "uint32_t",
  total_files_searched: "uint32_t",
  total_files: "uint32_t",
  filtered_file_count: "uint32_t",
  next_file_offset: "uint32_t",
  regex_fallback_error: "void *",
});

const FFF_GREP_MATCH = koffi.struct("FffGrepMatch", {
  relative_path: "void *",
  file_name: "void *",
  git_status: "void *",
  line_content: "void *",
  match_ranges: "void *",
  context_before: "void *",
  context_after: "void *",
  size: "uint64_t",
  modified: "uint64_t",
  total_frecency_score: "int64_t",
  access_frecency_score: "int64_t",
  modification_frecency_score: "int64_t",
  line_number: "uint64_t",
  byte_offset: "uint64_t",
  col: "uint32_t",
  match_ranges_count: "uint32_t",
  context_before_count: "uint32_t",
  context_after_count: "uint32_t",
  fuzzy_score: "uint32_t",
  has_fuzzy_score: "bool",
  is_binary: "bool",
  is_definition: "bool",
});

export class FffNoteSearch {
  private handle: NativePointer | null = null;
  private initialized = false;
  private initializing: Promise<FffLibrary> | null = null;
  private library: FffLibrary | null = null;

  constructor(
    private readonly notesRoot: string,
    private readonly dataRoot: string,
  ) {}

  async search(query: string, scope: SearchScope = "all"): Promise<NoteSearchResponse> {
    const parsed = parseSearchInput(query, scope);
    const [title, content] = await Promise.all([
      parsed.scope === "content"
        ? Promise.resolve<TitleSearchResult[]>([])
        : this.collectTitleResults(parsed.query),
      parsed.scope === "title"
        ? Promise.resolve<ContentSearchResult[]>([])
        : this.collectContentResults(parsed.query),
    ]);

    return {
      best: [],
      content,
      query: parsed.query,
      scope: parsed.scope,
      title,
    };
  }

  async searchTitles(query: string): Promise<NoteTitleSearchResponse> {
    const parsed = parseSearchInput(query, "all");

    return {
      query: parsed.query,
      scope: parsed.scope,
      title: parsed.scope === "content" ? [] : await this.collectTitleResults(parsed.query),
    };
  }

  async searchContent(query: string): Promise<NoteContentSearchResponse> {
    const parsed = parseSearchInput(query, "all");

    return {
      content: parsed.scope === "title" ? [] : await this.collectContentResults(parsed.query),
      query: parsed.query,
      scope: parsed.scope,
    };
  }

  private async collectTitleResults(query: string) {
    const library = await this.ensureInitialized();
    const seen = new Set<string>();
    const results: TitleSearchResult[] = [];
    let totalMatched = 0;

    for (let pageIndex = 0; pageIndex < MAX_SEARCH_PAGES; pageIndex += 1) {
      const searchResult = this.readSearchResult(
        library.search(this.requireHandle(), query, "", 0, pageIndex, SEARCH_PAGE_SIZE, 0, 0),
      );
      totalMatched = searchResult.total_matched;

      for (const relativePath of searchResult.items) {
        const notePath = normalizeSearchResultPath(relativePath);
        if (!notePath || seen.has(notePath)) continue;

        seen.add(notePath);
        const result = createTitleResult(notePath, query);
        if (matchesTitleQuery(result, query)) results.push(result);
        if (results.length >= SEARCH_RESULT_LIMIT) return results;
      }

      const scannedResults = (pageIndex + 1) * SEARCH_PAGE_SIZE;
      if (searchResult.count < SEARCH_PAGE_SIZE || scannedResults >= totalMatched) break;
    }

    return results;
  }

  private async collectContentResults(query: string) {
    const trimmedQuery = query.trim();
    if (!trimmedQuery) return [];

    const library = await this.ensureInitialized();
    const grepResult = this.readGrepResult(
      library.grep(
        this.requireHandle(),
        `*.md ${trimmedQuery}`,
        0,
        0,
        2,
        true,
        0,
        CONTENT_RESULT_LIMIT * 2,
        80,
        0,
        0,
        false,
      ),
      trimmedQuery,
    );
    const seen = new Set<string>();
    const results: ContentSearchResult[] = [];

    for (const result of grepResult.items) {
      const key = `${result.notePath}:${result.jump.lineNumber}:${result.jump.matchStart}`;
      if (seen.has(key)) continue;

      seen.add(key);
      results.push(result);
      if (results.length >= CONTENT_RESULT_LIMIT) break;
    }

    return results;
  }

  async trackSelection(query: string, notePath: string) {
    if (!query.trim()) return;

    const library = await this.ensureInitialized();
    this.readVoidResult(
      library.trackQuery(
        this.requireHandle(),
        query,
        path.resolve(this.notesRoot, `${normalizeNotePath(notePath)}.md`),
      ),
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

    const library = loadFffLibrary();
    this.library = library;
    let result: NativePointer;
    try {
      result = this.readHandleResult(
        library.createInstance(
          this.notesRoot,
          path.join(this.dataRoot, "fff-frecency.mdb"),
          path.join(this.dataRoot, "fff-history.mdb"),
          false,
          false,
          false,
          true,
          false,
          "",
          "",
          0,
          0,
          0,
        ),
      );
    } catch (error) {
      library.unload();
      this.library = null;
      throw error;
    }

    this.handle = result;
    this.initialized = true;
    this.readVoidResult(library.waitForScan(this.requireHandle(), 1000));
    return library;
  }

  private readHandleResult(resultPointer: NativePointer) {
    const envelope = this.readResult(resultPointer);
    if (!envelope.handle || isNullPointer(envelope.handle)) {
      throw new Error("fff-search returned a null handle");
    }

    return envelope.handle;
  }

  private readSearchResult(resultPointer: NativePointer) {
    const library = this.requireLibrary();
    const searchResultPointer = this.readHandleResult(resultPointer);

    try {
      const raw = koffi.decode(searchResultPointer, FFF_SEARCH_RESULT) as FffSearchResult;
      const items: string[] = [];

      for (let index = 0; index < raw.count; index += 1) {
        const item = library.searchResultItem(searchResultPointer, index);
        const relativePath = library.fileItemRelativePath(item);
        if (relativePath) items.push(relativePath);
      }

      return {
        count: raw.count,
        items,
        total_matched: raw.total_matched,
      };
    } finally {
      library.freeSearchResult(searchResultPointer);
    }
  }

  private readGrepResult(resultPointer: NativePointer, query: string) {
    const library = this.requireLibrary();
    const grepResultPointer = this.readHandleResult(resultPointer);

    try {
      const raw = koffi.decode(grepResultPointer, FFF_GREP_RESULT) as FffGrepResult;
      const items: ContentSearchResult[] = [];
      const regexError = readCString(raw.regex_fallback_error);
      if (regexError) throw new Error(regexError);

      for (let index = 0; index < raw.count; index += 1) {
        const match = library.grepResultMatch(grepResultPointer, index);
        const rawMatch = koffi.decode(match, FFF_GREP_MATCH) as FffGrepMatch;
        const relativePath = readCString(rawMatch.relative_path) ?? "";
        const notePath = normalizeSearchResultPath(relativePath);
        const lineContent = readCString(rawMatch.line_content) ?? "";
        if (!notePath || !lineContent.trim()) continue;

        items.push(
          createContentResult(notePath, {
            lineContent,
            lineNumber: Number(rawMatch.line_number),
            matchEnd: getMatchEnd(rawMatch.col, query, lineContent),
            matchStart: rawMatch.col,
            query,
          }),
        );
      }

      return { items };
    } finally {
      library.freeGrepResult(grepResultPointer);
    }
  }

  private readVoidResult(resultPointer: NativePointer) {
    this.readResult(resultPointer);
  }

  private readResult(resultPointer: NativePointer) {
    const library = this.requireLibrary();

    try {
      const result = koffi.decode(resultPointer, FFF_RESULT) as FffResult;
      if (!result.success) {
        throw new Error(readCString(result.error) ?? "fff-search failed");
      }

      return result;
    } finally {
      library.freeResult(resultPointer);
    }
  }

  private requireHandle() {
    if (!this.handle) throw new Error("fff-search is not initialized");
    return this.handle;
  }

  private requireLibrary() {
    if (!this.library) throw new Error("fff-search library is not loaded");
    return this.library;
  }
}

function loadFffLibrary(): FffLibrary {
  const binaryPath = findFffBinary();
  if (!binaryPath) {
    throw new Error("fff-search native library was not found");
  }

  const library = koffi.load(binaryPath);
  return {
    createInstance: library.func("fff_create_instance2", koffi.pointer(FFF_RESULT), [
      "str",
      "str",
      "str",
      "bool",
      "bool",
      "bool",
      "bool",
      "bool",
      "str",
      "str",
      "uint64_t",
      "uint64_t",
      "uint64_t",
    ]) as FffLibrary["createInstance"],
    destroy: library.func("void fff_destroy(void *handle)") as FffLibrary["destroy"],
    fileItemRelativePath: library.func(
      "str fff_file_item_get_relative_path(void *item)",
    ) as FffLibrary["fileItemRelativePath"],
    freeGrepResult: library.func(
      "void fff_free_grep_result(void *result)",
    ) as FffLibrary["freeGrepResult"],
    freeResult: library.func("void fff_free_result(FffResult *result)") as FffLibrary["freeResult"],
    freeSearchResult: library.func(
      "void fff_free_search_result(void *result)",
    ) as FffLibrary["freeSearchResult"],
    grep: library.func("fff_live_grep", koffi.pointer(FFF_RESULT), [
      "void *",
      "str",
      "uint8_t",
      "uint64_t",
      "uint32_t",
      "bool",
      "uint32_t",
      "uint32_t",
      "uint64_t",
      "uint32_t",
      "uint32_t",
      "bool",
    ]) as FffLibrary["grep"],
    grepResultMatch: library.func(
      "void *fff_grep_result_get_match(void *result, uint32_t index)",
    ) as FffLibrary["grepResultMatch"],
    search: library.func("fff_search", koffi.pointer(FFF_RESULT), [
      "void *",
      "str",
      "str",
      "uint32_t",
      "uint32_t",
      "uint32_t",
      "int32_t",
      "uint32_t",
    ]) as FffLibrary["search"],
    searchResultItem: library.func(
      "void *fff_search_result_get_item(void *result, uint32_t index)",
    ) as FffLibrary["searchResultItem"],
    trackQuery: library.func("fff_track_query", koffi.pointer(FFF_RESULT), [
      "void *",
      "str",
      "str",
    ]) as FffLibrary["trackQuery"],
    unload: () => library.unload(),
    waitForScan: library.func("fff_wait_for_scan", koffi.pointer(FFF_RESULT), [
      "void *",
      "uint64_t",
    ]) as FffLibrary["waitForScan"],
  };
}

function findFffBinary() {
  const filename = getFffLibraryFilename();
  const packagedBinary = findPackagedFffBinary(filename);
  if (packagedBinary) return packagedBinary;

  return (
    findFffBinaryFromRequire(createRequire(import.meta.url), filename) ??
    findFffNodeBinary(filename)
  );
}

function findFffNodeBinary(filename: string) {
  try {
    const fffNodeIndexPath = fileURLToPath(import.meta.resolve("@ff-labs/fff-node"));
    const fffNodePackageRoot = path.resolve(path.dirname(fffNodeIndexPath), "../..");
    return findFffBinaryFromRequire(
      createRequire(path.join(fffNodePackageRoot, "package.json")),
      filename,
    );
  } catch {
    return null;
  }
}

function findFffBinaryFromRequire(require: NodeJS.Require, filename: string) {
  try {
    const packageJsonPath = require.resolve(`${getFffBinaryPackageName()}/package.json`);
    const binaryPath = path.join(path.dirname(packageJsonPath), filename);
    return existsSync(binaryPath) ? binaryPath : null;
  } catch {
    return null;
  }
}

function findPackagedFffBinary(filename: string) {
  const resourceRoot = (process as NodeJS.Process & { resourcesPath?: string }).resourcesPath;
  if (!resourceRoot || resourceRoot === process.cwd()) return null;

  return findFile(path.join(resourceRoot, "fff-bin"), filename) ?? findFile(resourceRoot, filename);
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

function getFffLibraryFilename() {
  if (process.platform === "win32") return "fff_c.dll";
  if (process.platform === "darwin") return "libfff_c.dylib";
  return "libfff_c.so";
}

function getFffBinaryPackageName() {
  const platform = process.platform;
  const arch = process.arch;

  if (platform === "darwin" && arch === "arm64") return "@ff-labs/fff-bin-darwin-arm64";
  if (platform === "darwin" && arch === "x64") return "@ff-labs/fff-bin-darwin-x64";
  if (platform === "win32" && arch === "arm64") return "@ff-labs/fff-bin-win32-arm64";
  if (platform === "win32" && arch === "x64") return "@ff-labs/fff-bin-win32-x64";
  if (platform === "linux" && arch === "arm64") return "@ff-labs/fff-bin-linux-arm64-gnu";
  if (platform === "linux" && arch === "x64") return "@ff-labs/fff-bin-linux-x64-gnu";

  throw new Error(`fff-search does not ship a binary for ${platform}/${arch}`);
}

function isNullPointer(pointer: NativePointer) {
  try {
    return koffi.address(pointer) === 0n;
  } catch {
    return pointer === null || pointer === undefined;
  }
}

function readCString(pointer: NativePointer | null) {
  if (!pointer || isNullPointer(pointer)) return null;
  return koffi.decode(pointer, "char", -1) as string;
}

function normalizeSearchResultPath(relativePath: string) {
  const notePath = normalizeNotePath(relativePath);
  if (!notePath.toLowerCase().endsWith(".md")) return null;

  return notePath.replace(/\.md$/i, "");
}

function normalizeNotePath(notePath: string) {
  return notePath
    .split(/[\\/]+/)
    .filter(Boolean)
    .join("/");
}

function parseSearchInput(query: string, fallbackScope: SearchScope) {
  const trimmedQuery = query.trim();
  const lowerQuery = trimmedQuery.toLowerCase();

  if (lowerQuery.startsWith("in:content ")) {
    return { query: trimmedQuery.slice("in:content ".length).trim(), scope: "content" as const };
  }
  if (lowerQuery.startsWith("in:title ")) {
    return { query: trimmedQuery.slice("in:title ".length).trim(), scope: "title" as const };
  }
  if (trimmedQuery.startsWith("/")) {
    return { query: trimmedQuery.slice(1).trim(), scope: "content" as const };
  }
  if (trimmedQuery.startsWith("#")) {
    return { query: trimmedQuery, scope: "content" as const };
  }

  return { query: trimmedQuery, scope: fallbackScope };
}

function matchesTitleQuery(result: TitleSearchResult, query: string) {
  const normalizedQuery = normalizeSearchText(query);
  if (!normalizedQuery) return true;

  const normalizedTitle = normalizeSearchText(result.title);
  const normalizedPath = normalizeSearchText(result.notePath);
  const words = normalizedQuery.split(" ").filter(Boolean);

  return words.every((word) => normalizedTitle.includes(word) || normalizedPath.includes(word));
}

function createTitleResult(notePath: string, query: string): TitleSearchResult {
  const { directory, title } = getNoteDisplayParts(notePath);
  const normalizedQuery = query.trim().toLowerCase();
  const normalizedTitle = title.toLowerCase();

  return {
    directory,
    exact: Boolean(normalizedQuery) && normalizedTitle === normalizedQuery,
    id: `title:${notePath}`,
    notePath,
    title,
    type: "title",
  };
}

function createContentResult(
  notePath: string,
  jump: ContentSearchResult["jump"],
): ContentSearchResult {
  const { directory, title } = getNoteDisplayParts(notePath);

  return {
    directory,
    id: `content:${notePath}:${jump.lineNumber}:${jump.matchStart}`,
    jump,
    notePath,
    snippet: jump.lineContent,
    title,
    type: "content",
  };
}

function getNoteDisplayParts(notePath: string) {
  const segments = notePath.split("/");
  const filename = segments.at(-1) ?? notePath;
  const title = filename.endsWith(".md") ? filename.slice(0, -3) : filename;

  return {
    directory: segments.slice(0, -1).join("/"),
    title,
  };
}

function normalizeSearchText(value: string) {
  return value
    .trim()
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .replace(/\s+/g, " ");
}

function getMatchEnd(matchStart: number, query: string, lineContent: string) {
  const normalizedLine = lineContent.toLowerCase();
  const normalizedQuery = query.trim().toLowerCase();
  if (!normalizedQuery) return matchStart;

  const directIndex = normalizedLine.indexOf(normalizedQuery, Math.max(0, matchStart - 1));
  if (directIndex >= 0) return directIndex + normalizedQuery.length;
  return Math.min(lineContent.length, matchStart + normalizedQuery.length);
}
