import { FileTree, useFileTree } from "@pierre/trees/react";
import { useEffect } from "react";

export function FileTreeFeature({
  notes,
  onError,
  onMove,
  onOpenNote,
}: {
  notes: string[];
  onError: (message: string) => void;
  onMove: (sourcePath: string, destinationPath: string, isFolder: boolean) => void;
  onOpenNote: (notePath: string) => void;
}) {
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
      const notePath = selectedPaths[0];
      if (notePath) onOpenNote(notePath);
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
    model.resetPaths(notes);
  }, [model, notes]);

  return <FileTree className="sidebar-tree" model={model} />;
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
