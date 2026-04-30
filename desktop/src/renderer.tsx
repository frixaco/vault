import { Markdown } from "@tiptap/markdown";
import StarterKit from "@tiptap/starter-kit";
import { EditorContent, useEditor } from "@tiptap/react";
import { StrictMode, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import { CommandPalette } from "./command-palette.js";
import { VaultEmbed, VaultLink } from "./editor-embed.js";
import {
  applyMediaLayoutToEditor,
  collectEditorMediaLayout,
  deleteEditorMedia,
  MEDIA_ACTION_LEAVE_EVENT,
  MEDIA_ACTION_TARGET_EVENT,
  resetEditorMediaSize,
  setCurrentMarkdownNotePath,
  setMediaLayoutCommitHandler,
  updateEditorMediaPath,
  VaultImage,
  VaultMedia,
} from "./editor-media.js";
import type { MediaActionTargetDetail } from "./editor-media.js";
import { FileTreeFeature } from "./file-tree-feature.js";
import type { SidebarSortMode } from "./file-tree-feature.js";
import { IconSort } from "./icon-sort.js";
import { createEmptyMediaLayout } from "./media-layout.js";
import type { MediaLayoutFile } from "./media-layout.js";
import { vaultApi } from "./renderer-api.js";
import { SettingsPanel } from "./settings-panel.js";
import { TabBar } from "./tab-bar.js";
import { createDraftTab, createInitialTabState, createNoteTab, ensureOpenTab } from "./tabs.js";
import type { EditorTab } from "./tabs.js";
import type { NoteMeta, NotesTreePatchEvent } from "./note-events.js";
import type { NoteSearchResult, SearchJump } from "./search-types.js";
import { VaultSelectionScreen } from "./vault-selection-screen.js";
import type { OpenVaultResult } from "./vault-session.js";

function isBlankMarkdown(content: string) {
  return (
    content
      .split(/\r?\n/)
      .filter((line) => !/^#{1,6}\s*$/.test(line.trim()))
      .join("\n")
      .trim().length === 0
  );
}

function getTitleFromMarkdown(content: string) {
  const firstLine = content.split(/\r?\n/, 1)[0]?.trim() ?? "";
  const title = firstLine.replace(/^#{1,6}\s+/, "").trim();
  return title;
}

function ensureTitleLineFromPath(notePath: string, content: string) {
  const titleLine = `# ${getPathBasename(notePath)}`;
  const match = content.match(/^(.*?)(\r?\n|$)([\s\S]*)$/);
  const firstLine = match?.[1]?.trim() ?? "";
  const body = match?.[3] ?? "";

  if (getTitleFromMarkdown(firstLine)) {
    return body.length > 0 ? `${titleLine}\n${body}` : `${titleLine}\n`;
  }

  return content.trim() ? `${titleLine}\n\n${content}` : `${titleLine}\n`;
}

function stripTreeDirectory(path: string) {
  return path.endsWith("/") ? path.slice(0, -1) : path;
}

function getPathBasename(path: string) {
  return stripTreeDirectory(path).split("/").at(-1) ?? stripTreeDirectory(path);
}

type PendingSearchJump = {
  jump: SearchJump;
  notePath: string;
};

type MediaAction = "delete" | "edit" | "reset";

const sidebarSortOptions: Array<{ label: string; mode: SidebarSortMode }> = [
  { label: "Alphabetical A-Z", mode: { direction: "asc", key: "alphabetical" } },
  { label: "Alphabetical Z-A", mode: { direction: "desc", key: "alphabetical" } },
  { label: "Modified newest", mode: { direction: "desc", key: "modified" } },
  { label: "Modified oldest", mode: { direction: "asc", key: "modified" } },
  { label: "Created newest", mode: { direction: "desc", key: "created" } },
  { label: "Created oldest", mode: { direction: "asc", key: "created" } },
];

const defaultSidebarSortMode: SidebarSortMode = { direction: "asc", key: "alphabetical" };

function getSidebarSortModeId(mode: SidebarSortMode) {
  return `${mode.key}:${mode.direction}`;
}

function getSidebarSortLabel(mode: SidebarSortMode) {
  return (
    sidebarSortOptions.find(
      (option) => getSidebarSortModeId(option.mode) === getSidebarSortModeId(mode),
    )?.label ?? "Sort"
  );
}

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

function createNoteMetaRecord(notes: NoteMeta[]) {
  return Object.fromEntries(notes.map((note) => [note.path, note]));
}

function applyNoteMetaPatch(
  currentNoteMetaByPath: Readonly<Record<string, NoteMeta>>,
  patch: NotesTreePatchEvent,
) {
  const nextNoteMetaByPath = { ...currentNoteMetaByPath };

  for (const notePath of patch.removed) {
    delete nextNoteMetaByPath[notePath];
  }
  for (const note of patch.added) {
    nextNoteMetaByPath[note.path] = note;
  }
  for (const note of patch.updated) {
    nextNoteMetaByPath[note.path] = note;
  }

  return nextNoteMetaByPath;
}

function remapNoteMetaByPath(
  currentNoteMetaByPath: Readonly<Record<string, NoteMeta>>,
  sourcePath: string,
  destinationPath: string,
  isFolder: boolean,
) {
  const nextNoteMetaByPath: Record<string, NoteMeta> = {};

  for (const [notePath, noteMeta] of Object.entries(currentNoteMetaByPath)) {
    const nextPath = remapNotePath(notePath, sourcePath, destinationPath, isFolder);
    nextNoteMetaByPath[nextPath] =
      nextPath === notePath
        ? noteMeta
        : { ...noteMeta, ...getNotePathParts(nextPath), path: nextPath };
  }

  return nextNoteMetaByPath;
}

function createPlaceholderNoteMeta(notePath: string): NoteMeta {
  const timestamp = Date.now();
  return {
    ...getNotePathParts(notePath),
    birthtimeMs: timestamp,
    mtimeMs: timestamp,
    path: notePath,
    size: 0,
  };
}

function getNotePathParts(notePath: string) {
  const segments = notePath.split("/");
  const fileName = segments.at(-1) ?? notePath;

  return {
    directory: segments.slice(0, -1).join("/"),
    fileName,
    title: fileName,
  };
}

function SidebarSortControl({
  onChange,
  value,
}: {
  onChange: (mode: SidebarSortMode) => void;
  value: SidebarSortMode;
}) {
  const [open, setOpen] = useState(false);
  const controlRef = useRef<HTMLDivElement | null>(null);
  const currentSortId = getSidebarSortModeId(value);

  useEffect(() => {
    if (!open) return;

    function handlePointerDown(event: PointerEvent) {
      if (event.target instanceof Node && controlRef.current?.contains(event.target)) return;
      setOpen(false);
    }

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") setOpen(false);
    }

    window.addEventListener("pointerdown", handlePointerDown, true);
    window.addEventListener("keydown", handleKeyDown, true);
    return () => {
      window.removeEventListener("pointerdown", handlePointerDown, true);
      window.removeEventListener("keydown", handleKeyDown, true);
    };
  }, [open]);

  return (
    <div className="sidebar-sort-control" ref={controlRef}>
      <button
        type="button"
        className="sidebar-icon-button"
        aria-expanded={open}
        aria-haspopup="menu"
        aria-label={`Sort: ${getSidebarSortLabel(value)}`}
        title={`Sort: ${getSidebarSortLabel(value)}`}
        onClick={() => setOpen((currentOpen) => !currentOpen)}
      >
        <IconSort />
      </button>
      {open ? (
        <div className="sidebar-sort-menu" role="menu">
          {sidebarSortOptions.map((option) => {
            const optionId = getSidebarSortModeId(option.mode);
            return (
              <button
                key={optionId}
                type="button"
                role="menuitemradio"
                aria-checked={optionId === currentSortId}
                onClick={() => {
                  onChange(option.mode);
                  setOpen(false);
                }}
              >
                {option.label}
              </button>
            );
          })}
        </div>
      ) : null}
    </div>
  );
}

function MediaActionRail({
  onAction,
  onPointerEnter,
  onPointerLeave,
  target,
}: {
  onAction: (action: MediaAction) => void;
  onPointerEnter: () => void;
  onPointerLeave: () => void;
  target: MediaActionTargetDetail | null;
}) {
  if (!target) return null;

  const top = Math.max(48, target.rect.top);
  const left = Math.max(8, target.rect.left - 8);

  return (
    <div
      className="media-action-rail"
      onPointerEnter={onPointerEnter}
      onPointerLeave={onPointerLeave}
      style={{ left, top }}
    >
      <button type="button" aria-label="Edit media path" onClick={() => onAction("edit")}>
        <MediaActionIcon action="edit" />
      </button>
      <button
        type="button"
        aria-label="Reset media size"
        disabled={!target.width}
        onClick={() => onAction("reset")}
      >
        <MediaActionIcon action="reset" />
      </button>
      <button type="button" aria-label="Delete from note" onClick={() => onAction("delete")}>
        <MediaActionIcon action="delete" />
      </button>
    </div>
  );
}

function MediaActionIcon({ action }: { action: MediaAction }) {
  return (
    <svg viewBox="0 0 16 16" aria-hidden="true">
      <path d={getMediaActionIconPath(action)} />
    </svg>
  );
}

function getMediaActionIconPath(action: MediaAction) {
  if (action === "delete") {
    return "M4.5 4.5h7m-5.5 0v7m4-7v7M6 2.5h4l.6 2H5.4l.6-2Zm-2 2 1 9h6l1-9";
  }

  if (action === "reset") {
    return "M4.5 6.5 2.5 4.5l2-2M3 4.5h6a4 4 0 1 1-3.4 6.1";
  }

  return "M3 11.5v1.5h1.5l7.1-7.1-1.5-1.5L3 11.5Zm6-6 1.5 1.5M10 3.5l1-1 1.5 1.5-1 1";
}

function App() {
  const [mode, setMode] = useState<"select-vault" | "editor">("select-vault");
  const [notes, setNotes] = useState<string[]>([]);
  const [noteMetaByPath, setNoteMetaByPath] = useState<Record<string, NoteMeta>>({});
  const [sidebarSortMode, setSidebarSortMode] = useState<SidebarSortMode>(defaultSidebarSortMode);
  const [, setStatus] = useState("Loading…");
  const [error, setError] = useState<string | null>(null);
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [pendingSearchJump, setPendingSearchJump] = useState<PendingSearchJump | null>(null);
  const [mediaActionTarget, setMediaActionTarget] = useState<MediaActionTargetDetail | null>(null);
  const [tabState, setTabState] = useState(createInitialTabState);
  const tabStateRef = useRef(tabState);
  const notesRef = useRef(new Set<string>());
  const editorPaneRef = useRef<HTMLElement | null>(null);
  const applyingEditorContentRef = useRef(false);
  const autosaveTimersRef = useRef(new Map<string, ReturnType<typeof setTimeout>>());
  const creatingTempTabsRef = useRef(new Set<string>());
  const lastSavedContentRef = useRef(new Map<string, string>());
  const mediaLayoutsRef = useRef(new Map<string, MediaLayoutFile>());
  const mediaActionCloseTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const mediaActionRailHoveredRef = useRef(false);
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
  const activeNotePath = activeTab?.kind === "note" ? activeTab.path : null;

  useEffect(() => {
    tabStateRef.current = tabState;
  }, [tabState]);

  useEffect(() => {
    notesRef.current = new Set(notes);
  }, [notes]);

  useEffect(() => {
    if (mode !== "editor") return;
    void vaultApi.setOpenNotePaths({ paths: openNotePaths }).catch(() => {});
  }, [mode, openNotePathsKey]);

  const handleVaultOpened = useCallback((result: OpenVaultResult) => {
    setNotes(result.notes);
    setNoteMetaByPath({});
    setStatus(`${result.notes.length} notes`);
    setError(null);
    setSidebarOpen(true);
    setTabState(createInitialTabState());
    lastSavedContentRef.current.clear();
    mediaLayoutsRef.current.clear();
    setMode("editor");
  }, []);

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

  const openNewDraftNote = useCallback(() => {
    const tab = createDraftTab();
    setTabState((current) => ({
      activeTabId: tab.id,
      tabs: [...current.tabs, tab],
    }));
  }, []);

  const loadMediaLayout = useCallback(async (notePath: string) => {
    const layout = await vaultApi.openMediaLayout(notePath);
    mediaLayoutsRef.current.set(notePath, layout);
    return layout;
  }, []);

  const openMarkdownNote = useCallback(
    async (notePath: string, jump?: SearchJump) => {
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
        const [content, layout] = await Promise.all([
          vaultApi.openNote(notePath),
          loadMediaLayout(notePath),
        ]);
        const normalizedContent = ensureTitleLineFromPath(notePath, content);
        mediaLayoutsRef.current.set(notePath, layout);
        lastSavedContentRef.current.set(notePath, normalizedContent);
        setTabState((current) => {
          const nextTab = createNoteTab(notePath, normalizedContent);

          if (current.tabs.some((tab) => tab.kind === "note" && tab.path === notePath)) {
            const existingNoteTab = current.tabs.find(
              (tab) => tab.kind === "note" && tab.path === notePath,
            );
            return {
              ...current,
              activeTabId: existingNoteTab?.id ?? current.activeTabId,
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
    },
    [loadMediaLayout],
  );

  useEffect(() => {
    openMarkdownNoteRef.current = (notePath: string) => {
      void openMarkdownNote(notePath);
    };
  }, [openMarkdownNote]);

  const refreshNotes = useCallback(async () => {
    if (mode !== "editor") return;

    const noteMetas = await vaultApi.listNoteMeta();
    setNoteMetaByPath(createNoteMetaRecord(noteMetas));
    setNotes(noteMetas.map((note) => note.path));
    setStatus(`${noteMetas.length} notes`);
  }, [mode]);

  const updateOpenNotePaths = useCallback(
    (sourcePath: string, destinationPath: string, isFolder: boolean) => {
      setTabState((current) => {
        const savedContent = lastSavedContentRef.current.get(sourcePath);
        if (savedContent !== undefined) {
          lastSavedContentRef.current.delete(sourcePath);
          lastSavedContentRef.current.set(destinationPath, savedContent);
        }

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
      setNoteMetaByPath((currentNoteMetaByPath) =>
        remapNoteMetaByPath(
          currentNoteMetaByPath,
          normalizedSource,
          normalizedDestination,
          isFolder,
        ),
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
        setNoteMetaByPath((currentNoteMetaByPath) =>
          remapNoteMetaByPath(
            currentNoteMetaByPath,
            normalizedDestination,
            normalizedSource,
            isFolder,
          ),
        );
        updateOpenNotePaths(normalizedDestination, normalizedSource, isFolder);
        await refreshNotes();
      }
    },
    [refreshNotes, updateOpenNotePaths],
  );

  const deleteSidebarItem = useCallback(async (sourcePath: string, isFolder: boolean) => {
    setError(null);
    try {
      await vaultApi.deleteNote({ isFolder, sourcePath: stripTreeDirectory(sourcePath) });
    } catch (deleteError: unknown) {
      setError(deleteError instanceof Error ? deleteError.message : String(deleteError));
    }
  }, []);

  const copySidebarItemPath = useCallback(async (sourcePath: string, isFolder: boolean) => {
    setError(null);
    try {
      await vaultApi.copyNotePath({ isFolder, sourcePath: stripTreeDirectory(sourcePath) });
    } catch (copyError: unknown) {
      setError(copyError instanceof Error ? copyError.message : String(copyError));
    }
  }, []);

  const revealSidebarItem = useCallback(async (sourcePath: string, isFolder: boolean) => {
    setError(null);
    try {
      await vaultApi.revealNote({ isFolder, sourcePath: stripTreeDirectory(sourcePath) });
    } catch (revealError: unknown) {
      setError(revealError instanceof Error ? revealError.message : String(revealError));
    }
  }, []);

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
      const activeTab = tabStateRef.current.tabs.find((tab) => tab.id === activeTabId);
      if (activeTab?.kind === "note" || activeTab?.kind === "draft") {
        if (ensureFirstBlockIsH1(editor)) return;
      }

      const content = editor.getMarkdown();
      setTabState((current) => ({
        ...current,
        tabs: current.tabs.map((tab) =>
          tab.id === activeTabId
            ? {
                ...tab,
                content,
                label: tab.kind === "draft" ? getTitleFromMarkdown(content) : tab.label,
              }
            : tab,
        ),
      }));
    },
  });

  const persistMediaLayout = useCallback(
    (sourceEditor: NonNullable<ReturnType<typeof useEditor>>) => {
      const activeEditorTab = tabStateRef.current.tabs.find(
        (tab) => tab.id === tabStateRef.current.activeTabId,
      );
      if (activeEditorTab?.kind !== "note") return;

      const layout = collectEditorMediaLayout(sourceEditor);
      mediaLayoutsRef.current.set(activeEditorTab.path, layout);
      void vaultApi
        .saveMediaLayout({ layout, path: activeEditorTab.path })
        .catch((saveError: unknown) => {
          setError(saveError instanceof Error ? saveError.message : String(saveError));
        });
    },
    [],
  );

  const clearMediaActionCloseTimer = useCallback(() => {
    const timer = mediaActionCloseTimerRef.current;
    if (!timer) return;

    clearTimeout(timer);
    mediaActionCloseTimerRef.current = null;
  }, []);

  const closeMediaActionRailSoon = useCallback(() => {
    clearMediaActionCloseTimer();
    mediaActionCloseTimerRef.current = setTimeout(() => {
      mediaActionCloseTimerRef.current = null;
      if (!mediaActionRailHoveredRef.current) setMediaActionTarget(null);
    }, 120);
  }, [clearMediaActionCloseTimer]);

  const handleMediaAction = useCallback(
    (action: MediaAction) => {
      if (!editor || !mediaActionTarget) return;

      if (action === "edit") {
        const nextTarget = window.prompt("Media path", mediaActionTarget.target)?.trim();
        if (!nextTarget || nextTarget === mediaActionTarget.target) return;
        if (updateEditorMediaPath(editor, mediaActionTarget.position, nextTarget)) {
          persistMediaLayout(editor);
          setMediaActionTarget(null);
        }
        return;
      }

      if (action === "reset") {
        if (resetEditorMediaSize(editor, mediaActionTarget.position)) {
          persistMediaLayout(editor);
          setMediaActionTarget((current) =>
            current?.position === mediaActionTarget.position
              ? { ...current, width: null }
              : current,
          );
        }
        return;
      }

      if (deleteEditorMedia(editor, mediaActionTarget.position)) {
        persistMediaLayout(editor);
        setMediaActionTarget(null);
      }
    },
    [editor, mediaActionTarget, persistMediaLayout],
  );

  useEffect(() => {
    if (!editor) return;

    setMediaLayoutCommitHandler((sourceEditor) => {
      if (sourceEditor !== editor) return;
      persistMediaLayout(sourceEditor);
    });

    return () => setMediaLayoutCommitHandler(null);
  }, [editor, persistMediaLayout]);

  useEffect(() => {
    if (!editor) return;

    const editorElement = editor.view.dom;

    function handleMediaTarget(event: Event) {
      const detail = (event as CustomEvent<MediaActionTargetDetail>).detail;
      if (!detail) return;

      clearMediaActionCloseTimer();
      setMediaActionTarget(detail);
    }

    function handleMediaLeave() {
      closeMediaActionRailSoon();
    }

    function handleEditorScroll() {
      setMediaActionTarget(null);
    }

    editorElement.addEventListener(MEDIA_ACTION_TARGET_EVENT, handleMediaTarget);
    editorElement.addEventListener(MEDIA_ACTION_LEAVE_EVENT, handleMediaLeave);
    editorPaneRef.current?.addEventListener("scroll", handleEditorScroll);

    return () => {
      editorElement.removeEventListener(MEDIA_ACTION_TARGET_EVENT, handleMediaTarget);
      editorElement.removeEventListener(MEDIA_ACTION_LEAVE_EVENT, handleMediaLeave);
      editorPaneRef.current?.removeEventListener("scroll", handleEditorScroll);
    };
  }, [clearMediaActionCloseTimer, closeMediaActionRailSoon, editor]);

  useEffect(() => {
    if (mode !== "editor") return;

    const liveTabIds = new Set(tabState.tabs.map((tab) => tab.id));
    for (const [tabId, timer] of autosaveTimersRef.current) {
      if (!liveTabIds.has(tabId)) {
        clearTimeout(timer);
        autosaveTimersRef.current.delete(tabId);
      }
    }

    for (const tab of tabState.tabs) {
      const existingTimer = autosaveTimersRef.current.get(tab.id);
      if (existingTimer) {
        clearTimeout(existingTimer);
        autosaveTimersRef.current.delete(tab.id);
      }

      if (tab.kind === "temp") {
        continue;
      }

      if (tab.kind === "draft") {
        if (isBlankMarkdown(tab.content) || creatingTempTabsRef.current.has(tab.id)) continue;
      } else if (lastSavedContentRef.current.get(tab.path) === tab.content) {
        continue;
      }

      const timer = setTimeout(() => {
        autosaveTimersRef.current.delete(tab.id);
        const latestTab = tabStateRef.current.tabs.find((candidate) => candidate.id === tab.id);
        if (!latestTab) return;

        if (latestTab.kind === "temp") return;

        if (latestTab.kind === "draft") {
          if (isBlankMarkdown(latestTab.content) || creatingTempTabsRef.current.has(latestTab.id)) {
            return;
          }

          creatingTempTabsRef.current.add(latestTab.id);
          void vaultApi
            .createNote({ content: latestTab.content })
            .then((createdNote) => {
              lastSavedContentRef.current.set(createdNote.path, createdNote.content);
              setNoteMetaByPath((currentNoteMetaByPath) => ({
                ...currentNoteMetaByPath,
                [createdNote.path]:
                  currentNoteMetaByPath[createdNote.path] ??
                  createPlaceholderNoteMeta(createdNote.path),
              }));
              setNotes((currentNotes) =>
                currentNotes.includes(createdNote.path)
                  ? currentNotes
                  : [...currentNotes, createdNote.path].sort((left, right) =>
                      left.localeCompare(right),
                    ),
              );
              setTabState((current) => {
                const currentTab = current.tabs.find((candidate) => candidate.id === latestTab.id);
                if (currentTab?.kind !== "draft") return current;

                const noteTab = createNoteTab(createdNote.path, createdNote.content);
                return {
                  activeTabId:
                    current.activeTabId === currentTab.id ? noteTab.id : current.activeTabId,
                  tabs: current.tabs.map((candidate) =>
                    candidate.id === currentTab.id ? noteTab : candidate,
                  ),
                };
              });
            })
            .catch((saveError: unknown) => {
              setError(saveError instanceof Error ? saveError.message : String(saveError));
            })
            .finally(() => {
              creatingTempTabsRef.current.delete(latestTab.id);
            });
          return;
        }

        void vaultApi
          .saveNote({ content: latestTab.content, path: latestTab.path })
          .then((savedNote) => {
            lastSavedContentRef.current.delete(latestTab.path);
            lastSavedContentRef.current.set(savedNote.path, savedNote.content);
            setNoteMetaByPath((currentNoteMetaByPath) =>
              remapNoteMetaByPath(currentNoteMetaByPath, latestTab.path, savedNote.path, false),
            );
            setNotes((currentNotes) => {
              const nextNotes = remapNotePaths(currentNotes, latestTab.path, savedNote.path, false);
              return nextNotes.includes(savedNote.path)
                ? nextNotes
                : [...nextNotes, savedNote.path].sort((left, right) => left.localeCompare(right));
            });
            setTabState((current) => {
              const currentTab = current.tabs.find((candidate) => candidate.id === latestTab.id);
              if (currentTab?.kind !== "note") return current;
              if (currentTab.path === savedNote.path && currentTab.content === savedNote.content) {
                return current;
              }

              const noteTab = createNoteTab(savedNote.path, savedNote.content);
              return {
                activeTabId:
                  current.activeTabId === currentTab.id ? noteTab.id : current.activeTabId,
                tabs: current.tabs.map((candidate) =>
                  candidate.id === currentTab.id ? noteTab : candidate,
                ),
              };
            });
          })
          .catch((saveError: unknown) => {
            setError(saveError instanceof Error ? saveError.message : String(saveError));
          });
      }, 1000);

      autosaveTimersRef.current.set(tab.id, timer);
    }
  }, [mode, tabState.tabs]);

  useEffect(() => {
    return () => {
      for (const timer of autosaveTimersRef.current.values()) clearTimeout(timer);
      autosaveTimersRef.current.clear();
    };
  }, []);

  useEffect(() => {
    if (mode !== "editor") return;
    if (!editor || !activeTab) return;

    applyingEditorContentRef.current = true;
    setCurrentMarkdownNotePath(activeTab.kind === "note" ? activeTab.path : "");
    if (isBlankMarkdown(activeTab.content)) {
      editor.commands.setContent(getEmptyEditorDocument(activeTab.kind), { emitUpdate: false });
    } else {
      editor.commands.setContent(activeTab.content, {
        contentType: "markdown",
        emitUpdate: false,
      });
    }
    applyMediaLayoutToEditor(
      editor,
      activeTab.kind === "note"
        ? (mediaLayoutsRef.current.get(activeTab.path) ?? createEmptyMediaLayout())
        : createEmptyMediaLayout(),
    );
    queueMicrotask(() => {
      applyingEditorContentRef.current = false;
      editor.commands.focus("start");
      editorPaneRef.current?.scrollTo({ left: 0, top: 0 });
    });
  }, [mode, activeTab?.id, editor]);

  useEffect(() => {
    if (mode !== "editor") return;
    if (!editor || activeTab?.kind !== "note") return;
    if (mediaLayoutsRef.current.has(activeTab.path)) return;

    let active = true;
    void loadMediaLayout(activeTab.path)
      .then((layout) => {
        if (!active) return;
        const currentTab = tabStateRef.current.tabs.find(
          (tab) => tab.id === tabStateRef.current.activeTabId,
        );
        if (currentTab?.kind !== "note" || currentTab.path !== activeTab.path) return;
        applyMediaLayoutToEditor(editor, layout);
      })
      .catch((layoutError: unknown) => {
        if (!active) return;
        setError(layoutError instanceof Error ? layoutError.message : String(layoutError));
      });

    return () => {
      active = false;
    };
  }, [mode, editor, activeTab, loadMediaLayout]);

  useEffect(() => {
    setMediaActionTarget(null);
  }, [activeTab?.id]);

  useEffect(() => {
    if (!editor || !activeTab || activeTab.kind !== "note" || !pendingSearchJump) return;
    if (pendingSearchJump.notePath !== activeTab.path) return;

    queueMicrotask(() => {
      selectSearchJump(editor, pendingSearchJump.jump);
      setPendingSearchJump(null);
    });
  }, [activeTab, editor, pendingSearchJump]);

  useEffect(() => {
    if (mode !== "editor") return;

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
  }, [mode, refreshNotes]);

  useEffect(() => {
    if (mode !== "editor") return;

    function applyOpenNoteContent(notePath: string, content: string) {
      const normalizedContent = ensureTitleLineFromPath(notePath, content);
      const activeNote = tabStateRef.current.tabs.find(
        (tab) => tab.id === tabStateRef.current.activeTabId && tab.kind === "note",
      );

      if (activeNote?.kind === "note" && activeNote.path === notePath) {
        if (activeNote.content !== normalizedContent) return;
        lastSavedContentRef.current.set(notePath, normalizedContent);
        return;
      }

      lastSavedContentRef.current.set(notePath, normalizedContent);
      setTabState((current) => ({
        ...current,
        tabs: current.tabs.map((tab) =>
          tab.kind === "note" && tab.path === notePath
            ? { ...tab, content: normalizedContent }
            : tab,
        ),
      }));
    }

    const unsubscribeTreePatch = vaultApi.onNotesTreePatch((patch) => {
      setNoteMetaByPath((currentNoteMetaByPath) =>
        applyNoteMetaPatch(currentNoteMetaByPath, patch),
      );
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
  }, [mode]);

  useEffect(() => {
    function handleKey(event: KeyboardEvent) {
      if (mode !== "editor") return;

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
        openNewDraftNote();
      } else if (mod && event.key.toLowerCase() === "w") {
        event.preventDefault();
        if (activeTab?.kind === "temp" || activeTab?.kind === "draft") {
          closeTab(activeTab.id);
        } else if (activeTab) {
          closeTab(activeTab.id);
        }
      } else if (event.key === "Escape" && sidebarOpen) {
        setSidebarOpen(false);
      }
    }
    window.addEventListener("keydown", handleKey, true);
    return () => window.removeEventListener("keydown", handleKey, true);
  }, [mode, sidebarOpen, activeTab, openNewDraftNote]);

  if (mode === "select-vault") {
    return <VaultSelectionScreen onOpenVault={handleVaultOpened} />;
  }

  return (
    <main className="relative h-full overflow-hidden bg-bg">
      <div
        className="fixed inset-x-0 top-0 z-30 h-10 [-webkit-app-region:drag] [app-region:drag]"
        aria-hidden="true"
      />

      <MediaActionRail
        target={mediaActionTarget}
        onAction={handleMediaAction}
        onPointerEnter={() => {
          mediaActionRailHoveredRef.current = true;
          clearMediaActionCloseTimer();
        }}
        onPointerLeave={() => {
          mediaActionRailHoveredRef.current = false;
          closeMediaActionRailSoon();
        }}
      />

      <div className="absolute inset-0 flex min-w-0">
        <aside
          className={`sidebar-panel z-20 flex h-full ${sidebarOpen ? "w-sidebar" : "w-0"} border-r border-hairline-strong bg-bg-raised`}
          data-open={sidebarOpen}
          aria-label="Notes"
          aria-hidden={!sidebarOpen}
        >
          <section className="w-0 overflow-hidden" aria-label="Workspace actions" />
          <section
            className="sidebar-panel-content flex min-w-0 flex-1 flex-col pt-12 pb-2"
            aria-label="Note list"
          >
            <header className="sidebar-header">
              <div className="sidebar-title">Notes</div>
              <SidebarSortControl value={sidebarSortMode} onChange={setSidebarSortMode} />
            </header>
            {error ? (
              <div className="px-2 pb-2">
                <div className="border border-hairline-strong bg-accent/10 px-2.5 py-2 font-vault-chrome text-[11px] text-accent">
                  {error}
                </div>
              </div>
            ) : null}
            <FileTreeFeature
              activeNotePath={activeNotePath}
              isSidebarOpen={sidebarOpen}
              noteMetaByPath={noteMetaByPath}
              notes={notes}
              onCopyPath={(sourcePath, isFolder) => {
                void copySidebarItemPath(sourcePath, isFolder);
              }}
              onDelete={(sourcePath, isFolder) => {
                void deleteSidebarItem(sourcePath, isFolder);
              }}
              onError={setError}
              onMove={(sourcePath, destinationPath, isFolder) => {
                void persistNoteMove(sourcePath, destinationPath, isFolder);
              }}
              onOpenNote={(notePath) => openMarkdownNoteRef.current(notePath)}
              onReveal={(sourcePath, isFolder) => {
                void revealSidebarItem(sourcePath, isFolder);
              }}
              sortMode={sidebarSortMode}
            />
          </section>
        </aside>

        <section className="relative flex min-w-0 flex-1 flex-col pt-10">
          <section
            className="flex min-w-0 flex-1 justify-center overflow-x-hidden overflow-y-auto [scrollbar-gutter:stable]"
            ref={editorPaneRef}
          >
            <EditorContent className="editor-width min-h-full" editor={editor} />
          </section>

          <div className="flex flex-none justify-center">
            <TabBar
              activeTabId={tabState.activeTabId}
              onActivateTab={(id) =>
                setTabState((current) => ({
                  ...current,
                  activeTabId: id,
                }))
              }
              onCloseTab={closeTab}
              onTabContextMenu={handleTabContextMenu}
              onTabMouseDown={handleTabMouseDown}
              tabs={tabState.tabs}
            />
          </div>
        </section>
      </div>

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

function getEmptyEditorDocument(tabKind: EditorTab["kind"]) {
  return {
    type: "doc",
    content: [
      tabKind === "note" || tabKind === "draft"
        ? {
            type: "heading",
            attrs: { level: 1 },
          }
        : { type: "paragraph" },
    ],
  };
}

function ensureFirstBlockIsH1(editor: NonNullable<ReturnType<typeof useEditor>>) {
  const firstNode = editor.state.doc.firstChild;
  if (firstNode?.type.name === "heading" && firstNode.attrs.level === 1) return false;

  return editor.commands.command(({ state, tr, dispatch }) => {
    const heading = state.schema.nodes.heading;
    if (!heading || !firstNode || !heading.validContent(firstNode.content)) return false;

    tr.setNodeMarkup(0, heading, { level: 1 });
    dispatch?.(tr);
    return true;
  });
}
