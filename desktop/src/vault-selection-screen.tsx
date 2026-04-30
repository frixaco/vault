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
    <main className="relative grid h-full bg-bg px-5 py-10 font-vault-chrome text-fg">
      <div
        className="fixed inset-x-0 top-0 h-10 z-10 [app-region:drag] [-webkit-app-region:drag]"
        aria-hidden="true"
      />

      <section className="mx-auto flex w-full max-w-160 flex-col justify-center gap-8">
        <header className="space-y-2">
          <p className="m-0 font-bold text-[11px] uppercase text-fg">Vault</p>
        </header>

        <div className="border-y border-hairline-strong">
          <button
            type="button"
            className="flex min-h-11 w-full items-center bg-transparent px-0 text-left text-[12px] text-fg-muted hover:text-fg disabled:cursor-default disabled:opacity-60"
            disabled={choosing || opening}
            onClick={chooseVaultDirectory}
          >
            {choosing ? "Choosing..." : summary ? "Change directory" : "Choose directory"}
          </button>

          {summary ? (
            <div className="border-t border-hairline py-4">
              <p className="m-0 break-all text-[12px] leading-normal text-fg">{summary.path}</p>
              <dl className="mt-4 grid grid-cols-3 border-y border-hairline text-[11px]">
                <VaultStat label="Files" value={summary.fileCount} />
                <VaultStat label="Notes" value={summary.noteCount} />
                <VaultStat label="Media" value={summary.mediaCount} />
              </dl>
              {summary.unreadableCount > 0 ? (
                <p className="m-0 pt-3 text-[11px] leading-normal text-accent">
                  {summary.unreadableCount} unreadable{" "}
                  {summary.unreadableCount === 1 ? "folder" : "folders"} skipped.
                </p>
              ) : null}
            </div>
          ) : null}
        </div>

        {error ? (
          <p className="m-0 border border-hairline-strong bg-accent/10 px-3 py-2 text-[11px] leading-normal text-accent">
            {error}
          </p>
        ) : null}

        <footer className="flex justify-end">
          <button
            type="button"
            className="h-8 min-w-24 bg-fg px-3 text-[12px] text-bg disabled:cursor-default disabled:opacity-35"
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
    <div className="border-r border-hairline py-3 last:border-r-0">
      <dt className="text-[10px] uppercase text-fg-faint">{label}</dt>
      <dd className="m-0 pt-1 text-[16px] text-fg">{value}</dd>
    </div>
  );
}
