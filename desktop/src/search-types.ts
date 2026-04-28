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

export type NoteTitleSearchResponse = {
  query: string;
  scope: SearchScope;
  title: TitleSearchResult[];
};

export type NoteContentSearchResponse = {
  content: ContentSearchResult[];
  query: string;
  scope: SearchScope;
};
