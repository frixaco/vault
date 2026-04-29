export type NativeEnvelope<T> = {
  error: string | null;
  ok: boolean;
  value: T | null;
};

export type VaultSearchInitOptions = {
  basePath: string;
  dataPath: string;
};

export type SearchFile = {
  directory: string;
  name: string;
  path: string;
  score: number;
};

export type SearchFilesResponse = {
  items: SearchFile[];
  totalFiles: number;
  totalMatched: number;
};

export type SearchProgress = {
  isScanning: boolean;
  scannedFilesCount: number;
};
