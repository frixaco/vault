import { NativeModule, requireNativeModule } from "expo";

declare class VaultSharedModule extends NativeModule {
  dispose(): void;
  getProgressJson(): Promise<string>;
  initialize(basePath: string, dataPath: string): Promise<void>;
  noteSearchJson(query: string, scope: string): Promise<string>;
  searchFilesJson(query: string, limit: number): Promise<string>;
  searchTrackSelectionJson(query: string, notePath: string): Promise<string>;
  waitForScan(timeoutMs: number): Promise<boolean>;
}

// This call loads the native module object from the JSI.
export default requireNativeModule<VaultSharedModule>("VaultShared");
