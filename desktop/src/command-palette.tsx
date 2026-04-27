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
    <div
      className="fixed inset-0 z-50 grid items-start justify-items-center bg-fg/20 px-6 pt-24 animate-palette-fade"
      role="dialog"
      aria-modal="true"
      onMouseDown={onClose}
    >
      <div
        className="w-full max-w-140 border border-hairline-strong bg-bg-raised"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <input
          className="h-10 w-full border-b border-hairline bg-transparent px-3.5 font-vault-chrome text-[13px] text-fg outline-none placeholder:text-fg-faint"
          placeholder="Jump to note, run command…"
          autoFocus
          aria-label="Command palette"
        />
        <div className="max-h-80 overflow-y-auto py-1" role="listbox">
          <button
            className="flex h-7 w-full items-center justify-between bg-transparent px-3.5 font-vault-chrome text-left text-[12px] text-fg-muted transition-colors duration-100 ease-vault hover:bg-active hover:text-fg aria-selected:bg-active aria-selected:text-fg"
            role="option"
            aria-selected="true"
            type="button"
            onClick={() => {
              onNewNote();
              onClose();
            }}
          >
            <span>New note</span>
            <span className="text-[11px] text-fg-faint">⌘N</span>
          </button>
          <button
            className="flex h-7 w-full items-center justify-between bg-transparent px-3.5 font-vault-chrome text-left text-[12px] text-fg-muted transition-colors duration-100 ease-vault hover:bg-active hover:text-fg aria-selected:bg-active aria-selected:text-fg"
            role="option"
            type="button"
          >
            <span>Toggle sidebar</span>
            <span className="text-[11px] text-fg-faint">⌘S</span>
          </button>
          <button
            className="flex h-7 w-full items-center justify-between bg-transparent px-3.5 font-vault-chrome text-left text-[12px] text-fg-muted transition-colors duration-100 ease-vault hover:bg-active hover:text-fg aria-selected:bg-active aria-selected:text-fg"
            role="option"
            type="button"
          >
            <span>Search in notes</span>
            <span className="text-[11px] text-fg-faint">⌘⇧F</span>
          </button>
          <button
            className="flex h-7 w-full items-center justify-between bg-transparent px-3.5 font-vault-chrome text-left text-[12px] text-fg-muted transition-colors duration-100 ease-vault hover:bg-active hover:text-fg aria-selected:bg-active aria-selected:text-fg"
            role="option"
            type="button"
            onClick={() => {
              onOpenSettings();
              onClose();
            }}
          >
            <span>Settings</span>
            <span className="text-[11px] text-fg-faint">⌘,</span>
          </button>
        </div>
      </div>
    </div>
  );
}
