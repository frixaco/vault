import { useEffect, useState } from "react";
import { IconClose } from "./icon-close.js";
import type { AttachmentsMigrationResult } from "./media-types.js";

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
      setMigrationResult(await window.vault.migrateAttachments());
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
    <div className="settings-backdrop" role="dialog" aria-modal="true" onMouseDown={onClose}>
      <section
        className="settings-panel"
        aria-label="Settings"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <header className="settings-header">
          <h1>Settings</h1>
          <button
            type="button"
            className="settings-close"
            aria-label="Close settings"
            onClick={onClose}
          >
            <IconClose />
          </button>
        </header>
        <div className="settings-list">
          <button
            type="button"
            className="settings-item"
            disabled={migrationRunning}
            onClick={handleMigrateAttachments}
          >
            <span>Migrate attachments</span>
            <span>{migrationRunning ? "Running" : "Run"}</span>
          </button>
        </div>
        {migrationResult ? (
          <p className="settings-result">{formatMigrationResult(migrationResult)}</p>
        ) : null}
        {migrationError ? <p className="settings-error">{migrationError}</p> : null}
      </section>
    </div>
  );
}
