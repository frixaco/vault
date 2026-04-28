import type { VaultApi } from "./vault-api.js";

declare global {
  interface Window {
    vault: VaultApi;
  }
}

export const vaultApi = window.vault;
