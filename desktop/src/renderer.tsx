import { FileTree, useFileTree } from "@pierre/trees/react";
import { Markdown } from "@tiptap/markdown";
import StarterKit from "@tiptap/starter-kit";
import { EditorContent, useEditor } from "@tiptap/react";
import { StrictMode, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import { CommandPalette } from "./command-palette.js";
import { VaultEmbed, VaultLink } from "./editor-embed.js";
import { setCurrentMarkdownNotePath, VaultImage, VaultMedia } from "./editor-media.js";
import { IconClose } from "./icon-close.js";
import { cn } from "./lib/utils.js";
import { vaultApi } from "./renderer-api.js";
import { SettingsPanel } from "./settings-panel.js";
import { createInitialTabState, createNoteTab, createTempTab, ensureOpenTab } from "./tabs.js";
import type { NotesTreePatchEvent } from "./note-events.js";
import type { NoteSearchResult, SearchJump } from "./search-types.js";

function isBlankMarkdown(content: string) {
  return content.trim().length === 0;
}

function stripTreeDirectory(path: string) {
  return path.endsWith("/") ? path.slice(0, -1) : path;
}

function getPathBasename(path: string) {
  return stripTreeDirectory(path).split("/").at(-1) ?? stripTreeDirectory(path);
}

function getMovedPath(sourcePath: string, directoryPath: string | null) {
  const basename = getPathBasename(sourcePath);
  return directoryPath ? `${stripTreeDirectory(directoryPath)}/${basename}` : basename;
}

type PendingSearchJump = {
  jump: SearchJump;
  notePath: string;
};

function remapNotePath(
  notePath: string,
  sourcePath: string,
  destinationPath: string,
  isFolder: boolean,
) {
  if (!isFolder) return notePath === sourcePath ? destinationPath : notePath;

  const sourcePrefix = `${sourcePath}/`;
  if (notePath === sourcePath) return destinationPath;
  if (!notePath.startsWith(sourcePrefix)) return notePath;
  return `${destinationPath}/${notePath.slice(sourcePrefix.length)}`;
}

function remapNotePaths(
  currentNotes: string[],
  sourcePath: string,
  destinationPath: string,
  isFolder: boolean,
) {
  return currentNotes
    .map((notePath) => remapNotePath(notePath, sourcePath, destinationPath, isFolder))
    .sort((left, right) => left.localeCompare(right));
}

function applyNotesTreePatch(currentNotes: string[], patch: NotesTreePatchEvent) {
  const nextNotes = new Set(currentNotes);

  for (const notePath of patch.removed) {
    nextNotes.delete(notePath);
  }
  for (const note of patch.added) {
    nextNotes.add(note.path);
  }
  for (const note of patch.updated) {
    nextNotes.add(note.path);
  }

  return [...nextNotes].sort((left, right) => left.localeCompare(right));
}

function App() {
  const [notes, setNotes] = useState<string[]>([]);
  const [status, setStatus] = useState("Loading…");
  const [error, setError] = useState<string | null>(null);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [pendingSearchJump, setPendingSearchJump] = useState<PendingSearchJump | null>(null);
  const [tabState, setTabState] = useState(createInitialTabState);
  const tabStateRef = useRef(tabState);
  const notesRef = useRef(new Set<string>());
  const editorPaneRef = useRef<HTMLElement | null>(null);
  const applyingEditorContentRef = useRef(false);
  const openMarkdownNoteRef = useRef<(path: string) => void>(() => {});
  const activeTab = useMemo(
    () => tabState.tabs.find((tab) => tab.id === tabState.activeTabId) ?? tabState.tabs[0] ?? null,
    [tabState],
  );
  const openNotePaths = useMemo(
    () => tabState.tabs.filter((tab) => tab.kind === "note").map((tab) => tab.path),
    [tabState.tabs],
  );
  const openNotePathsKey = openNotePaths.join("\n");

  useEffect(() => {
    tabStateRef.current = tabState;
  }, [tabState]);

  useEffect(() => {
    notesRef.current = new Set(notes);
  }, [notes]);

  useEffect(() => {
    void vaultApi.setOpenNotePaths({ paths: openNotePaths }).catch(() => {});
  }, [openNotePathsKey]);

  function closeTab(id: string) {
    setTabState((current) => {
      const closedIndex = current.tabs.findIndex((tab) => tab.id === id);
      if (closedIndex === -1) return current;

      const nextTabs = current.tabs.filter((tab) => tab.id !== id);
      if (nextTabs.length === 0) return createInitialTabState();
      if (id !== current.activeTabId) {
        return {
          ...current,
          tabs: nextTabs,
        };
      }

      const nextActiveTab = nextTabs[Math.min(closedIndex, nextTabs.length - 1)] ?? nextTabs[0]!;
      return {
        activeTabId: nextActiveTab.id,
        tabs: nextTabs,
      };
    });
  }

  function closeOthers(id: string) {
    setTabState((current) => {
      const tab = current.tabs.find((candidate) => candidate.id === id);
      if (!tab) return current;
      return {
        activeTabId: tab.id,
        tabs: [tab],
      };
    });
  }

  function closeRight(id: string) {
    setTabState((current) => {
      const index = current.tabs.findIndex((tab) => tab.id === id);
      if (index === -1) return current;
      const nextTabs = current.tabs.slice(0, index + 1);
      return ensureOpenTab({
        activeTabId: nextTabs.some((tab) => tab.id === current.activeTabId)
          ? current.activeTabId
          : id,
        tabs: nextTabs,
      });
    });
  }

  async function handleTabContextMenu(event: React.MouseEvent, id: string) {
    event.preventDefault();
    const index = tabState.tabs.findIndex((tab) => tab.id === id);
    const action = await vaultApi.openTabMenu({
      hasOthers: tabState.tabs.length > 1,
      hasRight: index >= 0 && index < tabState.tabs.length - 1,
    });
    if (action === "close") closeTab(id);
    else if (action === "close-others") closeOthers(id);
    else if (action === "close-right") closeRight(id);
  }

  function handleTabMouseDown(event: React.MouseEvent, id: string) {
    if (event.button === 1) {
      event.preventDefault();
      closeTab(id);
    }
  }

  const openNewTempNote = useCallback(() => {
    const tab = createTempTab();
    setTabState((current) => ({
      activeTabId: tab.id,
      tabs: [...current.tabs, tab],
    }));
  }, []);

  const openMarkdownNote = useCallback(async (notePath: string, jump?: SearchJump) => {
    if (!notesRef.current.has(notePath)) return;
    if (jump) setPendingSearchJump({ jump, notePath });

    const existingTab = tabStateRef.current.tabs.find(
      (tab) => tab.kind === "note" && tab.path === notePath,
    );
    if (existingTab) {
      setTabState((current) => ({
        ...current,
        activeTabId: existingTab.id,
      }));
      return;
    }

    setError(null);
    try {
      const content = await vaultApi.openNote(notePath);
      setTabState((current) => {
        const currentTab = current.tabs.find((tab) => tab.id === current.activeTabId);
        const nextTab = createNoteTab(notePath, content);

        if (current.tabs.some((tab) => tab.kind === "note" && tab.path === notePath)) {
          const existingNoteTab = current.tabs.find(
            (tab) => tab.kind === "note" && tab.path === notePath,
          );
          return {
            ...current,
            activeTabId: existingNoteTab?.id ?? current.activeTabId,
          };
        }

        if (currentTab?.kind === "temp") {
          return {
            activeTabId: nextTab.id,
            tabs: current.tabs.map((tab) => (tab.id === currentTab.id ? nextTab : tab)),
          };
        }

        return {
          activeTabId: nextTab.id,
          tabs: [...current.tabs, nextTab],
        };
      });
    } catch (openError: unknown) {
      setError(openError instanceof Error ? openError.message : String(openError));
    }
  }, []);

  useEffect(() => {
    openMarkdownNoteRef.current = (notePath: string) => {
      void openMarkdownNote(notePath);
    };
  }, [openMarkdownNote]);

  const refreshNotes = useCallback(async () => {
    const files = await vaultApi.listNotes();
    setNotes(files);
    setStatus(`${files.length} notes`);
  }, []);

  const updateOpenNotePaths = useCallback(
    (sourcePath: string, destinationPath: string, isFolder: boolean) => {
      setTabState((current) => {
        let nextActiveTabId = current.activeTabId;
        const nextTabs = current.tabs.map((tab) => {
          if (tab.kind !== "note") return tab;

          const nextPath = remapNotePath(tab.path, sourcePath, destinationPath, isFolder);
          if (nextPath === tab.path) return tab;

          const nextTab = {
            ...tab,
            id: `note:${nextPath}`,
            label: getPathBasename(nextPath),
            path: nextPath,
          };
          if (tab.id === current.activeTabId) nextActiveTabId = nextTab.id;
          return nextTab;
        });

        return {
          activeTabId: nextActiveTabId,
          tabs: nextTabs,
        };
      });
    },
    [],
  );

  const persistNoteMove = useCallback(
    async (sourcePath: string, destinationPath: string, isFolder: boolean) => {
      const normalizedSource = stripTreeDirectory(sourcePath);
      const normalizedDestination = stripTreeDirectory(destinationPath);
      if (normalizedSource === normalizedDestination) return;

      setError(null);
      setNotes((currentNotes) =>
        remapNotePaths(currentNotes, normalizedSource, normalizedDestination, isFolder),
      );
      updateOpenNotePaths(normalizedSource, normalizedDestination, isFolder);

      try {
        await vaultApi.moveNote({
          destinationPath: normalizedDestination,
          isFolder,
          sourcePath: normalizedSource,
        });
        await refreshNotes();
      } catch (moveError: unknown) {
        setError(moveError instanceof Error ? moveError.message : String(moveError));
        updateOpenNotePaths(normalizedDestination, normalizedSource, isFolder);
        await refreshNotes();
      }
    },
    [refreshNotes, updateOpenNotePaths],
  );

  const { model: noteTree } = useFileTree({
    dragAndDrop: {
      onDropComplete: ({ draggedPaths, target }) => {
        for (const draggedPath of draggedPaths) {
          const isFolder = draggedPath.endsWith("/");
          const destinationPath = getMovedPath(draggedPath, target.directoryPath);
          void persistNoteMove(draggedPath, destinationPath, isFolder);
        }
      },
      onDropError: (message) => {
        setError(message);
      },
    },
    flattenEmptyDirectories: true,
    initialExpansion: "closed",
    icons: {
      set: "none",
    },
    itemHeight: 26,
    onSelectionChange: (selectedPaths) => {
      const notePath = selectedPaths[0];
      if (notePath) openMarkdownNoteRef.current(notePath);
    },
    paths: [],
    renaming: {
      onError: (message) => {
        setError(message);
      },
      onRename: ({ destinationPath, isFolder, sourcePath }) => {
        void persistNoteMove(sourcePath, destinationPath, isFolder);
      },
    },
    search: false,
    stickyFolders: true,
    unsafeCSS: `
      button[data-type='item'] {
        border-radius: 2px;
        font-family: var(--font-chrome);
        font-size: 12px;
        height: 26px;
        padding-inline: 6px;
      }
      button[data-type='item']:hover {
        background: var(--hover);
      }
      button[data-item-type='file'] > [data-item-section='icon'] {
        display: none;
      }
      [data-item-section='content'] {
        white-space: nowrap;
      }
      [data-item-section='content'] [data-truncate-group-container='middle'],
      [data-item-section='content'] [data-truncate-group-container='middle'] > div,
      [data-item-section='content'] [data-truncate-container],
      [data-item-section='content'] [data-truncate-grid],
      [data-item-section='content'] [data-truncate-grid] > div,
      [data-item-section='content'] [data-truncate-content='visible'] {
        display: contents;
      }
      [data-item-section='content'] [data-truncate-marker-cell],
      [data-item-section='content'] [data-truncate-content='overflow'] {
        display: none;
      }
    `,
  });

  const editor = useEditor({
    autofocus: true,
    content: {
      type: "doc",
      content: [{ type: "paragraph" }],
    },
    extensions: [
      StarterKit.configure({
        link: false,
      }),
      VaultLink.configure({
        enableClickSelection: false,
        openOnClick: false,
      }),
      VaultImage,
      VaultMedia,
      VaultEmbed,
      Markdown,
    ],
    editorProps: {
      attributes: {
        "aria-label": "Vault editor",
        class: "editor-surface",
      },
      handleClick: (_view, _pos, event) => {
        const target = event.target instanceof Element ? event.target : null;
        const link = target?.closest<HTMLAnchorElement>("a[href]");

        if (!link) return false;
        if (!event.metaKey && !event.ctrlKey && !event.shiftKey) return false;

        event.preventDefault();
        window.open(link.getAttribute("href") ?? link.href, "_blank", "noopener,noreferrer");
        return true;
      },
    },
    immediatelyRender: false,
    onUpdate: ({ editor }) => {
      if (applyingEditorContentRef.current) return;

      const activeTabId = tabStateRef.current.activeTabId;
      const content = editor.getMarkdown();
      setTabState((current) => ({
        ...current,
        tabs: current.tabs.map((tab) => (tab.id === activeTabId ? { ...tab, content } : tab)),
      }));
    },
  });

  useEffect(() => {
    if (!editor || !activeTab) return;

    applyingEditorContentRef.current = true;
    setCurrentMarkdownNotePath(activeTab.kind === "note" ? activeTab.path : "");
    if (isBlankMarkdown(activeTab.content)) {
      editor.commands.setContent(
        {
          type: "doc",
          content: [{ type: "paragraph" }],
        },
        { emitUpdate: false },
      );
    } else {
      editor.commands.setContent(activeTab.content, {
        contentType: "markdown",
        emitUpdate: false,
      });
    }
    queueMicrotask(() => {
      applyingEditorContentRef.current = false;
      editor.commands.focus("start");
      editorPaneRef.current?.scrollTo({ left: 0, top: 0 });
    });
  }, [activeTab?.id, editor]);

  useEffect(() => {
    if (!editor || !activeTab || activeTab.kind !== "note" || !pendingSearchJump) return;
    if (pendingSearchJump.notePath !== activeTab.path) return;

    queueMicrotask(() => {
      selectSearchJump(editor, pendingSearchJump.jump);
      setPendingSearchJump(null);
    });
  }, [activeTab, editor, pendingSearchJump]);

  useEffect(() => {
    let active = true;
    refreshNotes()
      .then(() => {
        if (!active) return;
      })
      .catch((listError: unknown) => {
        if (!active) return;
        setError(listError instanceof Error ? listError.message : String(listError));
        setStatus("Could not load notes");
      });
    return () => {
      active = false;
    };
  }, [refreshNotes]);

  useEffect(() => {
    noteTree.resetPaths(notes);
  }, [noteTree, notes]);

  useEffect(() => {
    function applyOpenNoteContent(notePath: string, content: string) {
      const activeNote = tabStateRef.current.tabs.find(
        (tab) => tab.id === tabStateRef.current.activeTabId && tab.kind === "note",
      );

      setTabState((current) => ({
        ...current,
        tabs: current.tabs.map((tab) =>
          tab.kind === "note" && tab.path === notePath ? { ...tab, content } : tab,
        ),
      }));

      if (!editor || activeNote?.kind !== "note" || activeNote.path !== notePath) return;
      if (activeNote.content === content) return;

      applyingEditorContentRef.current = true;
      setCurrentMarkdownNotePath(notePath);
      if (isBlankMarkdown(content)) {
        editor.commands.setContent(
          {
            type: "doc",
            content: [{ type: "paragraph" }],
          },
          { emitUpdate: false },
        );
      } else {
        editor.commands.setContent(content, {
          contentType: "markdown",
          emitUpdate: false,
        });
      }
      queueMicrotask(() => {
        applyingEditorContentRef.current = false;
      });
    }

    const unsubscribeTreePatch = vaultApi.onNotesTreePatch((patch) => {
      setNotes((currentNotes) => {
        const nextNotes = applyNotesTreePatch(currentNotes, patch);
        setStatus(`${nextNotes.length} notes`);
        return nextNotes;
      });
    });
    const unsubscribeOpenNoteUpdated = vaultApi.onOpenNoteUpdated(({ content, path }) => {
      applyOpenNoteContent(path, content);
    });
    const unsubscribeNoteDeleted = vaultApi.onNoteDeleted((notePath) => {
      setTabState((current) => {
        const nextTabs = current.tabs.filter((tab) => tab.kind !== "note" || tab.path !== notePath);
        if (nextTabs.length === current.tabs.length) return current;

        return ensureOpenTab({
          activeTabId: nextTabs.some((tab) => tab.id === current.activeTabId)
            ? current.activeTabId
            : (nextTabs[0]?.id ?? ""),
          tabs: nextTabs,
        });
      });
    });
    const unsubscribeError = vaultApi.onNotesWatchError((message) => setError(message));

    return () => {
      unsubscribeTreePatch();
      unsubscribeOpenNoteUpdated();
      unsubscribeNoteDeleted();
      unsubscribeError();
    };
  }, [editor]);

  useEffect(() => {
    function handleKey(event: KeyboardEvent) {
      const mod = event.metaKey || event.ctrlKey;
      if (mod && event.key.toLowerCase() === "s") {
        event.preventDefault();
        setSidebarOpen((open) => !open);
      } else if (mod && event.key.toLowerCase() === "p") {
        event.preventDefault();
        setPaletteOpen((open) => !open);
      } else if (mod && event.key === ",") {
        event.preventDefault();
        setSettingsOpen((open) => !open);
      } else if (mod && event.key.toLowerCase() === "n") {
        event.preventDefault();
        openNewTempNote();
      } else if (mod && event.key.toLowerCase() === "w") {
        event.preventDefault();
        if (activeTab?.kind === "temp") {
          void vaultApi.closeWindow();
        } else if (activeTab) {
          closeTab(activeTab.id);
        }
      } else if (event.key === "Escape" && sidebarOpen) {
        setSidebarOpen(false);
      }
    }
    window.addEventListener("keydown", handleKey, true);
    return () => window.removeEventListener("keydown", handleKey, true);
  }, [sidebarOpen, activeTab, openNewTempNote]);

  return (
    <main className="relative h-full overflow-hidden bg-bg">
      <div
        className="fixed inset-x-0 top-0 h-10 z-10 [app-region:drag] [-webkit-app-region:drag]"
        aria-hidden="true"
      />

      <section
        className="fixed inset-x-0 top-10 bottom-tabbar min-w-0 overflow-x-hidden overflow-y-auto [scrollbar-gutter:stable]"
        ref={editorPaneRef}
      >
        <EditorContent editor={editor} />
      </section>

      <aside
        className="sidebar-panel fixed inset-y-0 left-0 z-20 pt-4 flex w-sidebar border-r border-hairline-strong bg-bg-raised"
        data-open={sidebarOpen}
        aria-label="Notes"
        aria-hidden={!sidebarOpen}
      >
        <section className="w-0 overflow-hidden" aria-label="Workspace actions" />
        <section
          className="sidebar-panel-content flex min-w-0 flex-1 flex-col pt-8 pb-2"
          aria-label="Note list"
        >
          {error ? (
            <div className="px-2 pb-2">
              <div className="border border-hairline-strong bg-accent/10 px-2.5 py-2 font-vault-chrome text-[11px] text-accent">
                {error}
              </div>
            </div>
          ) : null}
          <FileTree className="sidebar-tree" model={noteTree} />
        </section>
      </aside>

      <nav
        className="editor-width fixed bottom-0 left-1/2 z-10 flex h-tabbar -translate-x-1/2 items-center justify-center overflow-x-auto bg-transparent pointer-events-none [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
        aria-label="Open notes"
      >
        {tabState.tabs.map((tab, index) => (
          <button
            key={tab.id}
            type="button"
            className={cn(
              "group relative flex h-full min-w-0 max-w-45 flex-none items-center overflow-hidden whitespace-nowrap bg-transparent font-vault-chrome text-[12px] tracking-normal text-fg-faint pointer-events-auto transition-colors duration-100 ease-vault hover:text-fg-muted aria-selected:text-fg",
              index > 0 &&
                "before:absolute before:top-3 before:bottom-3 before:left-0 before:w-px before:bg-hairline-strong before:content-['']",
              tabState.activeTabId === tab.id &&
                tabState.tabs.length > 1 &&
                "after:absolute after:right-0 after:bottom-0 after:left-0 after:h-0.5 after:bg-accent after:content-['']",
            )}
            aria-selected={tabState.activeTabId === tab.id}
            onClick={() =>
              setTabState((current) => ({
                ...current,
                activeTabId: tab.id,
              }))
            }
            onContextMenu={(event) => handleTabContextMenu(event, tab.id)}
            onMouseDown={(event) => handleTabMouseDown(event, tab.id)}
          >
            <span className="flex min-w-0 flex-1 items-center justify-center gap-1 pl-2 pr-5">
              {tab.kind === "temp" ? null : (
                <span
                  className="inline-grid size-4 flex-none place-items-center overflow-hidden text-current opacity-0 transition-opacity duration-100 ease-vault group-hover:opacity-100 [&_.icon]:h-3 [&_.icon]:w-3"
                  role="button"
                  tabIndex={-1}
                  aria-label={`Close ${tab.label}`}
                  onClick={(event) => {
                    event.stopPropagation();
                    closeTab(tab.id);
                  }}
                >
                  <IconClose />
                </span>
              )}
              <span
                className={cn(
                  "overflow-hidden flex-1 text-ellipsis text-center",
                  tabState.activeTabId === tab.id ? "font-semibold" : "",
                )}
              >
                {tab.label}
              </span>
            </span>
          </button>
        ))}
      </nav>

      {paletteOpen ? (
        <CommandPalette
          onClose={() => setPaletteOpen(false)}
          onOpenNote={(result: NoteSearchResult, query) => {
            void vaultApi
              .trackNoteSearchSelection({ notePath: result.notePath, query })
              .catch(() => {});
            void openMarkdownNote(
              result.notePath,
              result.type === "content" ? result.jump : undefined,
            );
          }}
          searchNoteContent={vaultApi.searchNoteContent}
          searchNoteTitles={vaultApi.searchNoteTitles}
        />
      ) : null}

      {settingsOpen ? <SettingsPanel onClose={() => setSettingsOpen(false)} /> : null}
    </main>
  );
}

const root = document.querySelector("#root");

if (!root) {
  throw new Error("Missing #root element");
}

createRoot(root).render(
  <StrictMode>
    <App />
  </StrictMode>,
);

function selectSearchJump(editor: NonNullable<ReturnType<typeof useEditor>>, jump: SearchJump) {
  const range = findSearchRange(editor, jump);
  if (!range) return false;

  editor.commands.setTextSelection(range);
  editor.commands.focus();
  editor.commands.scrollIntoView();
  return true;
}

function findSearchRange(editor: NonNullable<ReturnType<typeof useEditor>>, jump: SearchJump) {
  const candidates = getSearchCandidates(jump);
  const textIndex = buildEditorTextIndex(editor);
  const normalizedText = textIndex.text.toLowerCase();

  for (const candidate of candidates) {
    const normalizedCandidate = candidate.toLowerCase();
    const index = normalizedText.indexOf(normalizedCandidate);
    if (index < 0) continue;

    const from = textIndex.positions[index];
    const to = textIndex.positions[index + candidate.length - 1];
    if (from === undefined || to === undefined) continue;

    return { from, to: to + 1 };
  }

  return null;
}

function getSearchCandidates(jump: SearchJump) {
  const highlighted = jump.lineContent.slice(jump.matchStart, jump.matchEnd).trim();
  const line = jump.lineContent.trim();
  const query = jump.query.trim();

  return [highlighted, line, query].filter((candidate) => candidate.length > 0);
}

function buildEditorTextIndex(editor: NonNullable<ReturnType<typeof useEditor>>) {
  const positions: number[] = [];
  let text = "";

  editor.state.doc.descendants((node, position) => {
    if (!node.isText || !node.text) return;

    for (let index = 0; index < node.text.length; index += 1) {
      text += node.text[index];
      positions.push(position + index);
    }
  });

  return { positions, text };
}
