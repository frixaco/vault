export type NoteMeta = {
  directory: string;
  fileName: string;
  mtimeMs: number;
  path: string;
  size: number;
  title: string;
};

export type NotesTreePatchEvent = {
  added: NoteMeta[];
  removed: string[];
  updated: NoteMeta[];
};

export type OpenNoteUpdatedEvent = {
  content: string;
  mtimeMs: number;
  path: string;
  size: number;
};
