import type { NoteMeta } from "./note-events.js";
import type { NoteTitleSearchResponse, TitleSearchResult } from "./search-types.js";
import { getNoteDisplayParts, normalizeSearchText, parseSearchInput } from "./search-utils.js";

export type NoteMetaSource = {
  listNoteMeta: () => NoteMeta[];
};

export class CachedTitleSearchProvider {
  constructor(private readonly noteMetaSource: NoteMetaSource) {}

  searchTitles(query: string): NoteTitleSearchResponse {
    const parsed = parseSearchInput(query, "all");
    if (parsed.scope === "content") {
      return { query: parsed.query, scope: parsed.scope, title: [] };
    }

    const normalizedQuery = normalizeSearchText(parsed.query);
    const words = normalizedQuery.split(" ").filter(Boolean);
    const title = this.noteMetaSource
      .listNoteMeta()
      .map((meta) => createTitleSearchCandidate(meta.path, parsed.query, words))
      .filter((result): result is TitleSearchResult & { score: number } => result !== null)
      .sort(
        (left, right) => right.score - left.score || left.notePath.localeCompare(right.notePath),
      )
      .slice(0, 80)
      .map(({ score: _score, ...result }) => result);

    return {
      query: parsed.query,
      scope: parsed.scope,
      title,
    };
  }
}

function createTitleSearchCandidate(notePath: string, query: string, words: string[]) {
  const { directory, title } = getNoteDisplayParts(notePath);
  const normalizedTitle = normalizeSearchText(title);
  const normalizedPath = normalizeSearchText(notePath);

  if (
    words.length > 0 &&
    !words.every((word) => normalizedTitle.includes(word) || normalizedPath.includes(word))
  ) {
    return null;
  }

  const normalizedQuery = normalizeSearchText(query);
  const exact = Boolean(normalizedQuery) && normalizedTitle === normalizedQuery;
  let score = 0;
  if (!normalizedQuery) score = 1;
  else if (exact) score = 1000;
  else if (normalizedTitle.startsWith(normalizedQuery)) score = 800;
  else if (normalizedTitle.includes(normalizedQuery)) score = 600;
  else score = 300 - Math.max(0, normalizedPath.length - normalizedQuery.length);

  return {
    directory,
    exact,
    id: `title:${notePath}`,
    notePath,
    score,
    title,
    type: "title" as const,
  };
}
