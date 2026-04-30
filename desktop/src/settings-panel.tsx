import { useEffect, useState } from "react";
import { IconClose } from "./icon-close.js";
import type { AttachmentsMigrationResult } from "./media-types.js";
import { vaultApi } from "./renderer-api.js";

function formatMigrationResult(result: AttachmentsMigrationResult) {
  if (result.referencesFound === 0) {
    return `Scanned ${result.notesScanned} notes. No attachment references found.`;
  }

  const missing = result.missingFiles.length > 0 ? ` ${result.missingFiles.length} missing.` : "";
  const renamed = result.renamedFiles > 0 ? ` ${result.renamedFiles} renamed.` : "";

  return `Copied ${result.copiedFiles} files across ${result.notesChanged} notes.${renamed}${missing}`;
}

export function SettingsPanel({ onClose }: { onClose: () => void }) {
  const [migrationResult, setMigrationResult] = useState<AttachmentsMigrationResult | null>(null);
  const [migrationError, setMigrationError] = useState<string | null>(null);
  const [migrationRunning, setMigrationRunning] = useState(false);

  useEffect(() => {
    function handleKey(event: KeyboardEvent) {
      if (event.key === "Escape") onClose();
    }
    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  }, [onClose]);

  async function handleMigrateAttachments() {
    setMigrationRunning(true);
    setMigrationError(null);
    try {
      setMigrationResult(await vaultApi.migrateAttachments());
    } catch (migrateError: unknown) {
      setMigrationResult(null);
      setMigrationError(
        migrateError instanceof Error ? migrateError.message : String(migrateError),
      );
    } finally {
      setMigrationRunning(false);
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 grid items-start justify-items-center bg-fg/20 px-6 pt-20 animate-palette-fade"
      role="dialog"
      aria-modal="true"
      onMouseDown={onClose}
    >
      <section
        className="w-full max-w-130 border border-hairline-strong bg-bg-raised"
        aria-label="Settings"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <header className="flex h-11 items-center justify-between border-b border-hairline px-3.5">
          <div className="font-vault-chrome text-[13px] font-medium text-fg">Settings</div>
          <button
            type="button"
            className="grid h-6 w-6 place-items-center bg-transparent text-fg-muted hover:text-fg"
            aria-label="Close settings"
            onClick={onClose}
          >
            <IconClose />
          </button>
        </header>
        <div className="py-1">
          <button
            type="button"
            className="flex min-h-8.5 w-full items-center justify-between bg-transparent px-3.5 font-vault-chrome text-left text-[12px] text-fg-muted hover:bg-active hover:text-fg disabled:cursor-default disabled:opacity-60 disabled:hover:bg-transparent disabled:hover:text-fg-muted"
            disabled={migrationRunning}
            onClick={handleMigrateAttachments}
          >
            <span>Migrate attachments</span>
            <span>{migrationRunning ? "Running" : "Run"}</span>
          </button>
        </div>
        {migrationResult ? (
          <div className="border-t border-hairline px-3.5 pt-2.5 pb-3 font-vault-chrome text-[11px] leading-normal text-fg-muted">
            {formatMigrationResult(migrationResult)}
          </div>
        ) : null}
        {migrationError ? (
          <div className="border-t border-hairline px-3.5 pt-2.5 pb-3 font-vault-chrome text-[11px] leading-normal text-accent">
            {migrationError}
          </div>
        ) : null}
      </section>
    </div>
  );
}
