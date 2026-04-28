import type { ContentSearchResult, SearchScope, TitleSearchResult } from "./search-types.js";

export function parseSearchInput(query: string, fallbackScope: SearchScope) {
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

export function normalizeSearchText(value: string) {
  return value
    .trim()
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .replace(/\s+/g, " ");
}

export function normalizeSearchResultPath(relativePath: string) {
  const notePath = normalizeNotePath(relativePath);
  if (!notePath.toLowerCase().endsWith(".md")) return null;

  return notePath.replace(/\.md$/i, "");
}

export function normalizeNotePath(notePath: string) {
  return notePath
    .split(/[\\/]+/)
    .filter(Boolean)
    .join("/");
}

export function matchesTitleQuery(result: TitleSearchResult, query: string) {
  const normalizedQuery = normalizeSearchText(query);
  if (!normalizedQuery) return true;

  const normalizedTitle = normalizeSearchText(result.title);
  const normalizedPath = normalizeSearchText(result.notePath);
  const words = normalizedQuery.split(" ").filter(Boolean);

  return words.every((word) => normalizedTitle.includes(word) || normalizedPath.includes(word));
}

export function createTitleResult(notePath: string, query: string): TitleSearchResult {
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

export function createContentResult(
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

export function getNoteDisplayParts(notePath: string) {
  const segments = notePath.split("/");
  const filename = segments.at(-1) ?? notePath;
  const title = filename.endsWith(".md") ? filename.slice(0, -3) : filename;

  return {
    directory: segments.slice(0, -1).join("/"),
    title,
  };
}
