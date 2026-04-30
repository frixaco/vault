import { FileTree, useFileTree } from "@pierre/trees/react";
import type { FileTreeSortComparator } from "@pierre/trees";
import { useEffect, useMemo, useRef } from "react";
import type { NoteMeta } from "./note-events.js";

export type SidebarSortKey = "alphabetical" | "created" | "modified";
export type SidebarSortDirection = "asc" | "desc";

export type SidebarSortMode = {
  direction: SidebarSortDirection;
  key: SidebarSortKey;
};

export function FileTreeFeature({
  activeNotePath,
  isSidebarOpen,
  noteMetaByPath,
  notes,
  onCopyPath,
  onDelete,
  onError,
  onMove,
  onOpenNote,
  onReveal,
  sortMode,
}: {
  activeNotePath: string | null;
  isSidebarOpen: boolean;
  noteMetaByPath: Readonly<Record<string, NoteMeta>>;
  notes: string[];
  onCopyPath: (sourcePath: string, isFolder: boolean) => void;
  onDelete: (sourcePath: string, isFolder: boolean) => void;
  onError: (message: string) => void;
  onMove: (sourcePath: string, destinationPath: string, isFolder: boolean) => void;
  onOpenNote: (notePath: string) => void;
  onReveal: (sourcePath: string, isFolder: boolean) => void;
  sortMode: SidebarSortMode;
}) {
  const modelHostRef = useRef<HTMLDivElement | null>(null);
  const previousNotesRef = useRef<string[]>([]);
  const syncingSelectionRef = useRef(false);
  const sortStateRef = useRef({ noteMetaByPath, sortMode });
  sortStateRef.current = { noteMetaByPath, sortMode };

  const sort = useMemo<FileTreeSortComparator>(
    () => (left, right) => compareTreeEntries(left, right, sortStateRef.current),
    [],
  );

  const { model } = useFileTree({
    dragAndDrop: {
      onDropComplete: ({ draggedPaths, target }) => {
        for (const draggedPath of draggedPaths) {
          const isFolder = draggedPath.endsWith("/");
          const destinationPath = getMovedPath(draggedPath, target.directoryPath);
          onMove(draggedPath, destinationPath, isFolder);
        }
      },
      onDropError: (message) => {
        onError(message);
      },
    },
    flattenEmptyDirectories: true,
    initialExpansion: "closed",
    icons: {
      set: "none",
    },
    itemHeight: 26,
    onSelectionChange: (selectedPaths) => {
      if (syncingSelectionRef.current) return;
      const notePath = selectedPaths[0];
      if (notePath && !notePath.endsWith("/")) onOpenNote(notePath);
    },
    paths: [],
    renaming: {
      onError: (message) => {
        onError(message);
      },
      onRename: ({ destinationPath, isFolder, sourcePath }) => {
        onMove(sourcePath, destinationPath, isFolder);
      },
    },
    search: false,
    sort,
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

  useEffect(() => {
    const expandedPaths = collectExpandedDirectoryPaths(model, previousNotesRef.current);
    model.resetPaths(notes, { initialExpandedPaths: [...expandedPaths] });
    previousNotesRef.current = notes;
  }, [model, noteMetaByPath, notes, sortMode.direction, sortMode.key]);

  useEffect(() => {
    if (!isSidebarOpen || !activeNotePath || !notes.includes(activeNotePath)) return;

    expandAncestorDirectories(model, activeNotePath);
    syncingSelectionRef.current = true;
    selectOnlyTreePath(model, activeNotePath);
    model.focusPath(activeNotePath);

    window.setTimeout(() => {
      revealTreePath(modelHostRef.current, activeNotePath);
      syncingSelectionRef.current = false;
    }, 0);
  }, [activeNotePath, isSidebarOpen, model, notes]);

  return (
    <div className="sidebar-tree-wrap" ref={modelHostRef}>
      <FileTree
        className="sidebar-tree"
        model={model}
        renderContextMenu={(item, context) => {
          const isFolder = item.path.endsWith("/");
          return (
            <div className="sidebar-tree-menu">
              <button
                type="button"
                onClick={() => {
                  context.close({ restoreFocus: false });
                  model.startRenaming(item.path);
                }}
              >
                Rename
              </button>
              <button
                type="button"
                onClick={() => {
                  context.close({ restoreFocus: true });
                  onCopyPath(item.path, isFolder);
                }}
              >
                Copy path
              </button>
              <button
                type="button"
                onClick={() => {
                  context.close({ restoreFocus: true });
                  onReveal(item.path, isFolder);
                }}
              >
                Reveal in Finder
              </button>
              <button
                type="button"
                data-variant="danger"
                onClick={() => {
                  context.close({ restoreFocus: true });
                  onDelete(item.path, isFolder);
                }}
              >
                Delete
              </button>
            </div>
          );
        }}
      />
    </div>
  );
}

function compareTreeEntries(
  left: Parameters<FileTreeSortComparator>[0],
  right: Parameters<FileTreeSortComparator>[1],
  state: {
    noteMetaByPath: Readonly<Record<string, NoteMeta>>;
    sortMode: SidebarSortMode;
  },
) {
  if (left.isDirectory !== right.isDirectory) return left.isDirectory ? -1 : 1;

  if (left.isDirectory || state.sortMode.key === "alphabetical") {
    return compareByName(
      left,
      right,
      state.sortMode.key === "alphabetical" ? state.sortMode : null,
    );
  }

  const branchComparison = compareByBranch(left, right);
  if (branchComparison !== 0) return branchComparison;

  const leftMeta = state.noteMetaByPath[left.path];
  const rightMeta = state.noteMetaByPath[right.path];
  const leftValue = getSortTimestamp(leftMeta, state.sortMode.key);
  const rightValue = getSortTimestamp(rightMeta, state.sortMode.key);

  if (leftValue !== null && rightValue !== null && leftValue !== rightValue) {
    return state.sortMode.direction === "asc" ? leftValue - rightValue : rightValue - leftValue;
  }

  if (leftValue !== null || rightValue !== null) return leftValue !== null ? -1 : 1;
  return compareByName(left, right, null);
}

function compareByName(
  left: Parameters<FileTreeSortComparator>[0],
  right: Parameters<FileTreeSortComparator>[1],
  sortMode: SidebarSortMode | null,
) {
  const comparison =
    left.basename.localeCompare(right.basename) || left.path.localeCompare(right.path);
  return sortMode?.direction === "desc" ? -comparison : comparison;
}

function compareByBranch(
  left: Parameters<FileTreeSortComparator>[0],
  right: Parameters<FileTreeSortComparator>[1],
) {
  const leftParentSegments = left.segments.slice(0, -1);
  const rightParentSegments = right.segments.slice(0, -1);
  const sharedParentSegmentCount = Math.min(leftParentSegments.length, rightParentSegments.length);

  for (let index = 0; index < sharedParentSegmentCount; index += 1) {
    const comparison = leftParentSegments[index]!.localeCompare(rightParentSegments[index]!);
    if (comparison !== 0) return comparison;
  }

  if (leftParentSegments.length !== rightParentSegments.length) {
    return leftParentSegments.length - rightParentSegments.length;
  }

  return 0;
}

function getSortTimestamp(meta: NoteMeta | undefined, sortKey: SidebarSortKey) {
  const value = sortKey === "created" ? meta?.birthtimeMs : meta?.mtimeMs;
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? value : null;
}

function collectExpandedDirectoryPaths(
  model: ReturnType<typeof useFileTree>["model"],
  notes: string[],
) {
  const expandedPaths = new Set<string>();

  for (const directoryPath of getDirectoryPaths(notes)) {
    const item = model.getItem(directoryPath);
    if (item?.isDirectory() === true && "isExpanded" in item && item.isExpanded()) {
      expandedPaths.add(item.getPath());
    }
  }

  return expandedPaths;
}

function expandAncestorDirectories(
  model: ReturnType<typeof useFileTree>["model"],
  notePath: string,
) {
  for (const directoryPath of getAncestorDirectoryPaths(notePath)) {
    const item = model.getItem(directoryPath);
    if (item?.isDirectory() === true && "expand" in item) item.expand();
  }
}

function selectOnlyTreePath(model: ReturnType<typeof useFileTree>["model"], path: string) {
  for (const selectedPath of model.getSelectedPaths()) {
    model.getItem(selectedPath)?.deselect();
  }
  model.getItem(path)?.select();
}

function revealTreePath(host: HTMLDivElement | null, path: string) {
  const tree = host?.querySelector("file-tree-container");
  const shadowRoot = tree?.shadowRoot;
  if (!shadowRoot) return;

  for (const element of shadowRoot.querySelectorAll<HTMLElement>("button[data-item-path]")) {
    if (element.dataset.itemPath !== path) continue;
    element.scrollIntoView({ block: "nearest" });
    return;
  }
}

function getDirectoryPaths(notes: string[]) {
  const paths = new Set<string>();

  for (const notePath of notes) {
    for (const directoryPath of getAncestorDirectoryPaths(notePath)) paths.add(directoryPath);
  }

  return [...paths].sort((left, right) => left.localeCompare(right));
}

function getAncestorDirectoryPaths(path: string) {
  const segments = stripTreeDirectory(path).split("/").slice(0, -1);
  return segments.map((_, index) => `${segments.slice(0, index + 1).join("/")}/`);
}

function getMovedPath(sourcePath: string, directoryPath: string | null) {
  const basename = getPathBasename(sourcePath);
  return directoryPath ? `${stripTreeDirectory(directoryPath)}/${basename}` : basename;
}

function getPathBasename(path: string) {
  return stripTreeDirectory(path).split("/").at(-1) ?? stripTreeDirectory(path);
}

function stripTreeDirectory(path: string) {
  return path.endsWith("/") ? path.slice(0, -1) : path;
}
