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

export type SearchScope = "all" | "title" | "content";

export type SearchJump = {
  lineContent: string;
  lineNumber: number;
  matchEnd: number;
  matchStart: number;
  query: string;
};

export type TitleSearchResult = {
  directory: string;
  exact: boolean;
  id: string;
  notePath: string;
  title: string;
  type: "title";
};

export type ContentSearchResult = {
  directory: string;
  id: string;
  jump: SearchJump;
  notePath: string;
  snippet: string;
  title: string;
  type: "content";
};

export type NoteSearchResult = TitleSearchResult | ContentSearchResult;

export type NoteSearchResponse = {
  best: NoteSearchResult[];
  content: ContentSearchResult[];
  query: string;
  scope: SearchScope;
  title: TitleSearchResult[];
};
