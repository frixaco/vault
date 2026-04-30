import { useState } from "react";
import { vaultApi } from "./renderer-api.js";
import type { OpenVaultResult, VaultDirectorySummary } from "./vault-session.js";

type VaultSelectionScreenProps = {
  onOpenVault: (result: OpenVaultResult) => void;
};

export function VaultSelectionScreen({ onOpenVault }: VaultSelectionScreenProps) {
  const [summary, setSummary] = useState<VaultDirectorySummary | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [choosing, setChoosing] = useState(false);
  const [opening, setOpening] = useState(false);

  async function chooseVaultDirectory() {
    setChoosing(true);
    setError(null);
    try {
      const selectedSummary = await vaultApi.chooseVaultDirectory();
      if (selectedSummary) setSummary(selectedSummary);
    } catch (chooseError: unknown) {
      setError(chooseError instanceof Error ? chooseError.message : String(chooseError));
    } finally {
      setChoosing(false);
    }
  }

  async function openVault() {
    if (!summary) return;

    setOpening(true);
    setError(null);
    try {
      onOpenVault(await vaultApi.openVault({ path: summary.path }));
    } catch (openError: unknown) {
      setError(openError instanceof Error ? openError.message : String(openError));
    } finally {
      setOpening(false);
    }
  }

  return (
    <main className="relative grid h-full justify-items-center bg-bg px-6 py-10 font-vault-chrome text-fg">
      <div
        className="fixed inset-x-0 top-0 h-10 z-10 [app-region:drag] [-webkit-app-region:drag]"
        aria-hidden="true"
      />

      <section className="flex w-full max-w-2xl flex-col justify-center gap-8">
        <header className="pb-2">
          <div className="text-xs font-bold uppercase text-fg">Vault</div>
        </header>

        <div className="border-y border-hairline-strong">
          <button
            type="button"
            className="flex min-h-12 w-full items-center bg-transparent px-0 text-left text-sm text-fg-muted hover:text-fg disabled:cursor-default disabled:opacity-60"
            disabled={choosing || opening}
            onClick={chooseVaultDirectory}
          >
            {choosing ? "Choosing..." : summary ? "Change directory" : "Choose directory"}
          </button>

          {summary ? (
            <div className="pt-4 pb-6">
              <div className="break-all text-sm leading-normal text-fg">{summary.path}</div>
              <div className="pt-7">
                <div className="grid grid-cols-3 text-xs">
                  <VaultStat label="Files" value={summary.fileCount} />
                  <VaultStat label="Notes" value={summary.noteCount} />
                  <VaultStat label="Media" value={summary.mediaCount} />
                </div>
              </div>
              {summary.unreadableCount > 0 ? (
                <div className="pt-3 text-xs leading-normal text-accent">
                  {summary.unreadableCount} unreadable{" "}
                  {summary.unreadableCount === 1 ? "folder" : "folders"} skipped.
                </div>
              ) : null}
            </div>
          ) : null}
        </div>

        {error ? (
          <div className="border border-hairline-strong bg-accent/10 px-3 py-2 text-xs leading-normal text-accent">
            {error}
          </div>
        ) : null}

        <footer className="flex justify-end">
          <button
            type="button"
            className="h-8 min-w-24 bg-fg px-3 text-sm text-bg disabled:cursor-default disabled:opacity-35"
            disabled={!summary || choosing || opening}
            onClick={openVault}
          >
            {opening ? "Opening" : "Finish"}
          </button>
        </footer>
      </section>
    </main>
  );
}

function VaultStat({ label, value }: { label: string; value: number }) {
  return (
    <div className="border-r border-hairline px-6 py-3 first:pl-0 last:border-r-0">
      <div className="text-xs uppercase text-fg-faint">{label}</div>
      <div className="pt-1 text-2xl text-fg">{value}</div>
    </div>
  );
}
