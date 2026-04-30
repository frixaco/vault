import { useEffect, useState } from "react";
import type {
  ContentSearchResult,
  NoteContentSearchResponse,
  NoteSearchResult,
  NoteTitleSearchResponse,
  TitleSearchResult,
} from "./search-types.js";

export function CommandPalette({
  onClose,
  onOpenNote,
  searchNoteContent,
  searchNoteTitles,
}: {
  onClose: () => void;
  onOpenNote: (result: NoteSearchResult, query: string) => void;
  searchNoteContent: (payload: { query: string }) => Promise<NoteContentSearchResponse>;
  searchNoteTitles: (payload: { query: string }) => Promise<NoteTitleSearchResponse>;
}) {
  const [query, setQuery] = useState("");
  const [contentResults, setContentResults] = useState<ContentSearchResult[]>([]);
  const [titleResults, setTitleResults] = useState<TitleSearchResult[]>([]);
  const [searchQuery, setSearchQuery] = useState("");
  const [searchError, setSearchError] = useState<string | null>(null);
  const [contentSearching, setContentSearching] = useState(true);
  const [titleSearching, setTitleSearching] = useState(true);
  const [selectedIndex, setSelectedIndex] = useState(0);
  const results = [...titleResults, ...contentResults];
  const selectedResult = results[selectedIndex] ?? null;
  const searching = titleSearching || contentSearching;

  useEffect(() => {
    function handleKey(event: KeyboardEvent) {
      if (event.key === "Escape") onClose();
    }
    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  }, [onClose]);

  useEffect(() => {
    setSelectedIndex(0);
  }, [query]);

  useEffect(() => {
    let active = true;

    setSearchError(null);
    setSearchQuery(query.trim());
    setTitleResults([]);
    setContentResults([]);
    setTitleSearching(true);
    setContentSearching(true);

    searchNoteTitles({ query })
      .then((searchResponse) => {
        if (!active) return;
        setSearchQuery(searchResponse.query);
        setTitleResults(searchResponse.title);
      })
      .catch((error: unknown) => {
        if (!active) return;
        setTitleResults([]);
        setSearchError(error instanceof Error ? error.message : String(error));
      })
      .finally(() => {
        if (active) setTitleSearching(false);
      });

    searchNoteContent({ query })
      .then((searchResponse) => {
        if (!active) return;
        setSearchQuery(searchResponse.query);
        setContentResults(searchResponse.content);
      })
      .catch((error: unknown) => {
        if (!active) return;
        setContentResults([]);
        setSearchError(error instanceof Error ? error.message : String(error));
      })
      .finally(() => {
        if (active) setContentSearching(false);
      });

    return () => {
      active = false;
    };
  }, [query, searchNoteContent, searchNoteTitles]);

  useEffect(() => {
    if (selectedIndex >= results.length) setSelectedIndex(Math.max(0, results.length - 1));
  }, [results.length, selectedIndex]);

  function openResult(result: NoteSearchResult) {
    onOpenNote(result, result.type === "content" ? result.jump.query : searchQuery);
    onClose();
  }

  return (
    <div
      className="fixed inset-0 z-50 grid animate-palette-fade items-start justify-items-center bg-transparent px-6 pt-24"
      role="dialog"
      aria-modal="true"
      onMouseDown={onClose}
    >
      <div
        className="flex w-full max-w-130 flex-col border border-hairline-strong bg-bg-raised p-2 shadow-[0_18px_60px_oklch(0%_0_0/0.14)]"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <div className="pb-2">
          <input
            className="h-10 w-full border border-hairline bg-transparent px-3 font-vault-chrome text-[13px] text-fg outline-none placeholder:text-fg-faint"
            placeholder="Find file…"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "ArrowDown") {
                event.preventDefault();
                setSelectedIndex((index) => (results.length ? (index + 1) % results.length : 0));
              } else if (event.key === "ArrowUp") {
                event.preventDefault();
                setSelectedIndex((index) =>
                  results.length ? (index - 1 + results.length) % results.length : 0,
                );
              } else if (event.key === "Enter" && selectedResult) {
                event.preventDefault();
                openResult(selectedResult);
              }
            }}
            autoFocus
            aria-label="Find file"
            aria-controls="command-palette-results"
            aria-expanded="true"
          />
        </div>
        <div
          className="flex max-h-96 flex-col overflow-y-auto"
          id="command-palette-results"
          role="listbox"
        >
          {searchError ? (
            <div className="px-3.5 py-6 text-center font-vault-chrome text-[12px] text-accent">
              {searchError}
            </div>
          ) : results.length || query.trim() || searching ? (
            <>
              <section>
                <SectionLabel>Notes</SectionLabel>
                <div className="flex flex-col gap-0.5">
                  {titleResults.map((result, index) => (
                    <TitleResultButton
                      key={result.id}
                      result={result}
                      selected={index === selectedIndex}
                      onSelect={() => setSelectedIndex(index)}
                      onOpen={() => openResult(result)}
                    />
                  ))}
                </div>
              </section>
              <section className="pt-4">
                <SectionLabel>Note content</SectionLabel>
                <div className="flex flex-col gap-0.5">
                  {contentResults.map((result, contentIndex) => {
                    const index = titleResults.length + contentIndex;

                    return (
                      <ContentResultButton
                        key={result.id}
                        result={result}
                        selected={index === selectedIndex}
                        onSelect={() => setSelectedIndex(index)}
                        onOpen={() => openResult(result)}
                      />
                    );
                  })}
                </div>
              </section>
            </>
          ) : (
            <div className="px-3.5 py-6 text-center font-vault-chrome text-[12px] text-fg-faint">
              {searching ? "Searching notes" : "No notes"}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function SectionLabel({ children }: { children: string }) {
  return (
    <div className="pb-1 font-vault-chrome text-[10px] text-fg-faint uppercase">{children}</div>
  );
}

function TitleResultButton({
  onOpen,
  onSelect,
  result,
  selected,
}: {
  onOpen: () => void;
  onSelect: () => void;
  result: NoteSearchResult & { type: "title" };
  selected: boolean;
}) {
  return (
    <button
      className="group flex w-full min-w-0 flex-col gap-1 rounded-xs bg-transparent px-3 py-2 text-left font-vault-chrome text-[12px] text-fg-muted transition-colors duration-100 ease-vault hover:bg-active hover:text-fg aria-selected:bg-active aria-selected:text-fg"
      role="option"
      aria-selected={selected}
      type="button"
      onMouseEnter={onSelect}
      onClick={onOpen}
    >
      <span className="w-full min-w-0 overflow-hidden text-ellipsis whitespace-nowrap">
        {result.title}
      </span>
    </button>
  );
}

function ContentResultButton({
  onOpen,
  onSelect,
  result,
  selected,
}: {
  onOpen: () => void;
  onSelect: () => void;
  result: ContentSearchResult;
  selected: boolean;
}) {
  const start = Math.max(0, Math.min(result.jump.matchStart, result.snippet.length));
  const end = Math.max(start, Math.min(result.jump.matchEnd, result.snippet.length));

  return (
    <button
      className="group flex h-9 w-full min-w-0 items-center gap-3 rounded-xs bg-transparent px-3 text-left font-vault-chrome text-[12px] text-fg-muted transition-colors duration-100 ease-vault hover:bg-active hover:text-fg aria-selected:bg-active aria-selected:text-fg"
      role="option"
      aria-selected={selected}
      type="button"
      onMouseEnter={onSelect}
      onClick={onOpen}
    >
      <span className="shrink-0 overflow-hidden text-ellipsis whitespace-nowrap text-fg">
        {result.title}
      </span>
      <span className="min-w-0 flex-1 overflow-hidden text-[11px] text-ellipsis whitespace-nowrap text-fg-faint group-aria-selected:text-fg-muted">
        {result.snippet.slice(0, start)}
        <span className="bg-accent/15 text-fg">{result.snippet.slice(start, end)}</span>
        {result.snippet.slice(end)}
      </span>
    </button>
  );
}
