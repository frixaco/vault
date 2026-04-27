import { useEffect } from "react";

export function CommandPalette({
  onClose,
  onNewNote,
  onOpenSettings,
}: {
  onClose: () => void;
  onNewNote: () => void;
  onOpenSettings: () => void;
}) {
  useEffect(() => {
    function handleKey(event: KeyboardEvent) {
      if (event.key === "Escape") onClose();
    }
    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  }, [onClose]);

  return (
    <div className="palette-backdrop" role="dialog" aria-modal="true" onMouseDown={onClose}>
      <div className="palette" onMouseDown={(event) => event.stopPropagation()}>
        <input
          className="palette-input"
          placeholder="Jump to note, run command…"
          autoFocus
          aria-label="Command palette"
        />
        <div className="palette-list" role="listbox">
          <button
            className="palette-item"
            role="option"
            aria-selected="true"
            type="button"
            onClick={() => {
              onNewNote();
              onClose();
            }}
          >
            <span>New note</span>
            <span className="palette-hint">⌘N</span>
          </button>
          <button className="palette-item" role="option" type="button">
            <span>Toggle sidebar</span>
            <span className="palette-hint">⌘S</span>
          </button>
          <button className="palette-item" role="option" type="button">
            <span>Search in notes</span>
            <span className="palette-hint">⌘⇧F</span>
          </button>
          <button
            className="palette-item"
            role="option"
            type="button"
            onClick={() => {
              onOpenSettings();
              onClose();
            }}
          >
            <span>Settings</span>
            <span className="palette-hint">⌘,</span>
          </button>
        </div>
      </div>
    </div>
  );
}
