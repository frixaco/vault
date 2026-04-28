import { stat } from "node:fs/promises";
import { ipcMain } from "electron";
import type { NoteFileService } from "./note-file-service.js";
import type {
  NoteContentSearchResponse,
  NoteSearchResponse,
  NoteTitleSearchResponse,
  SearchScope,
} from "./search-types.js";

type TitleSearchProvider = {
  searchTitles: (query: string) => NoteTitleSearchResponse | Promise<NoteTitleSearchResponse>;
};

type ContentSearchProvider = {
  search: (query: string, scope: SearchScope) => Promise<NoteSearchResponse>;
  searchContent: (query: string) => Promise<NoteContentSearchResponse>;
  trackSelection: (query: string, notePath: string) => Promise<void>;
};

export type NoteIpcHandlersOptions = {
  contentSearch: ContentSearchProvider;
  noteFiles: NoteFileService;
  titleSearch: TitleSearchProvider;
};

export function registerNoteIpcHandlers({
  contentSearch,
  noteFiles,
  titleSearch,
}: NoteIpcHandlersOptions) {
  ipcMain.handle("notes:list", () => noteFiles.listNotePaths());
  ipcMain.handle("notes:create", (_, payload: { content: string }) =>
    noteFiles.createNote(payload.content),
  );
  ipcMain.handle("notes:move", (_, payload) => moveNote(noteFiles, payload));
  ipcMain.handle("notes:open", (_, notePath: string) => noteFiles.readNote(notePath));
  ipcMain.handle("notes:save", (_, payload: { content: string; path: string }) =>
    noteFiles.writeNote(payload.path, payload.content),
  );
  ipcMain.handle("notes:set-open-paths", (_, payload: { paths: string[] }) => {
    noteFiles.setOpenNotePaths(payload.paths);
  });
  ipcMain.handle("notes:search", (_, payload: { query: string; scope: SearchScope }) =>
    contentSearch.search(payload.query, payload.scope),
  );
  ipcMain.handle("notes:search-titles", (_, payload: { query: string }) =>
    titleSearch.searchTitles(payload.query),
  );
  ipcMain.handle("notes:search-content", (_, payload: { query: string }) =>
    contentSearch.searchContent(payload.query),
  );
  ipcMain.handle("notes:search-track", (_, payload: { notePath: string; query: string }) =>
    contentSearch.trackSelection(payload.query, payload.notePath),
  );
}

async function moveNote(
  noteFiles: NoteFileService,
  payload: { destinationPath: string; isFolder: boolean; sourcePath: string },
) {
  if (payload.sourcePath === payload.destinationPath) return;

  const destinationPath = payload.isFolder
    ? noteFiles.resolveNoteDirectory(payload.destinationPath)
    : noteFiles.resolveNoteFile(payload.destinationPath);

  if (await pathExists(destinationPath)) {
    throw new Error(`Destination already exists: "${payload.destinationPath}"`);
  }

  await noteFiles.moveNote(payload);
}

async function pathExists(filePath: string) {
  try {
    await stat(filePath);
    return true;
  } catch {
    return false;
  }
}
