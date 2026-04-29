import { NativeModule, requireNativeModule } from "expo";

declare class VaultSearchModule extends NativeModule {
  dispose(): void;
  getProgressJson(): Promise<string>;
  initialize(basePath: string, dataPath: string): Promise<void>;
  searchFilesJson(query: string, limit: number): Promise<string>;
  waitForScan(timeoutMs: number): Promise<boolean>;
}

// This call loads the native module object from the JSI.
export default requireNativeModule<VaultSearchModule>("VaultSearch");
