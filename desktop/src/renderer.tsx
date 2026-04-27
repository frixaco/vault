import Link from "@tiptap/extension-link";
import { FileTree, useFileTree } from "@pierre/trees/react";
import { Markdown } from "@tiptap/markdown";
import StarterKit from "@tiptap/starter-kit";
import { EditorContent, useEditor } from "@tiptap/react";
import { StrictMode, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import { CommandPalette } from "./command-palette.js";
import { setCurrentMarkdownNotePath, VaultImage, VaultMedia } from "./editor-media.js";
import { IconClose } from "./icon-close.js";
import { SettingsPanel } from "./settings-panel.js";
import { createInitialTabState, createNoteTab, createTempTab, ensureOpenTab } from "./tabs.js";
import type { AttachmentsMigrationResult } from "./media-types.js";

declare global {
  interface Window {
    vault: {
      closeWindow: () => Promise<void>;
      listNotes: () => Promise<string[]>;
      migrateAttachments: () => Promise<AttachmentsMigrationResult>;
      openNote: (path: string) => Promise<string>;
      openTabMenu: (payload: {
        hasOthers: boolean;
        hasRight: boolean;
      }) => Promise<"close" | "close-others" | "close-right" | null>;
    };
  }
}

function isBlankMarkdown(content: string) {
  return content.trim().length === 0;
}

function App() {
  const [notes, setNotes] = useState<string[]>([]);
  const [status, setStatus] = useState("Loading…");
  const [error, setError] = useState<string | null>(null);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
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

  useEffect(() => {
    tabStateRef.current = tabState;
  }, [tabState]);

  useEffect(() => {
    notesRef.current = new Set(notes);
  }, [notes]);

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
    const action = await window.vault.openTabMenu({
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

  const openMarkdownNote = useCallback(async (notePath: string) => {
    if (!notesRef.current.has(notePath)) return;

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
      const content = await window.vault.openNote(notePath);
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

  const { model: noteTree } = useFileTree({
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
      Link.configure({
        enableClickSelection: false,
        openOnClick: false,
      }),
      VaultImage,
      VaultMedia,
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
    let active = true;
    window.vault
      .listNotes()
      .then((files) => {
        if (!active) return;
        setNotes(files);
        setStatus(`${files.length} notes`);
      })
      .catch((listError: unknown) => {
        if (!active) return;
        setError(listError instanceof Error ? listError.message : String(listError));
        setStatus("Could not load notes");
      });
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    noteTree.resetPaths(notes);
  }, [noteTree, notes]);

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
          void window.vault.closeWindow();
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
    <main className="app-shell">
      <div className="window-drag-region" aria-hidden="true" />

      <section className="editor-pane" ref={editorPaneRef}>
        <EditorContent editor={editor} />
      </section>

      <aside
        className="sidebar"
        data-open={sidebarOpen}
        aria-label="Notes"
        aria-hidden={!sidebarOpen}
      >
        <section className="sidebar-actions" aria-label="Workspace actions" />
        <section className="sidebar-notes" aria-label="Note list">
          <div className="sidebar-status">{status}</div>
          {error ? <div className="sidebar-error">{error}</div> : null}
          <FileTree className="sidebar-tree" model={noteTree} />
        </section>
      </aside>

      <nav className="tabbar" aria-label="Open notes">
        {tabState.tabs.map((tab) => (
          <button
            key={tab.id}
            type="button"
            className="tab"
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
            <span
              className="tab-close"
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
            <span className="tab-label">{tab.label}</span>
          </button>
        ))}
      </nav>

      {paletteOpen ? (
        <CommandPalette
          onClose={() => setPaletteOpen(false)}
          onNewNote={openNewTempNote}
          onOpenSettings={() => setSettingsOpen(true)}
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
