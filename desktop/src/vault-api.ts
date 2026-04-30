import type { AttachmentsMigrationResult } from "./media-types.js";
import type { NoteMeta, NotesTreePatchEvent, OpenNoteUpdatedEvent } from "./note-events.js";
import type {
  NoteContentSearchResponse,
  NoteSearchResponse,
  NoteTitleSearchResponse,
  SearchScope,
} from "./search-types.js";
import type { OpenVaultResult, VaultDirectorySummary } from "./vault-session.js";

export type TabMenuAction = "close" | "close-others" | "close-right" | null;

export type VaultApi = {
  chooseVaultDirectory: () => Promise<VaultDirectorySummary | null>;
  closeWindow: () => Promise<void>;
  copyNotePath: (payload: { isFolder: boolean; sourcePath: string }) => Promise<string>;
  createNote: (payload: { content: string }) => Promise<{ content: string; path: string }>;
  deleteNote: (payload: { isFolder: boolean; sourcePath: string }) => Promise<void>;
  inspectVaultDirectory: (path: string) => Promise<VaultDirectorySummary>;
  listNoteMeta: () => Promise<NoteMeta[]>;
  listNotes: () => Promise<string[]>;
  migrateAttachments: () => Promise<AttachmentsMigrationResult>;
  moveNote: (payload: {
    destinationPath: string;
    isFolder: boolean;
    sourcePath: string;
  }) => Promise<void>;
  onNoteDeleted: (callback: (notePath: string) => void) => () => void;
  onNotesTreePatch: (callback: (event: NotesTreePatchEvent) => void) => () => void;
  onNotesWatchError: (callback: (message: string) => void) => () => void;
  onOpenNoteUpdated: (callback: (event: OpenNoteUpdatedEvent) => void) => () => void;
  openNote: (path: string) => Promise<string>;
  openPopup: (url: string) => Promise<void>;
  revealNote: (payload: { isFolder: boolean; sourcePath: string }) => Promise<void>;
  openTabMenu: (payload: { hasOthers: boolean; hasRight: boolean }) => Promise<TabMenuAction>;
  openVault: (payload: { path: string }) => Promise<OpenVaultResult>;
  searchNoteContent: (payload: { query: string }) => Promise<NoteContentSearchResponse>;
  searchNoteTitles: (payload: { query: string }) => Promise<NoteTitleSearchResponse>;
  searchNotes: (payload: { query: string; scope: SearchScope }) => Promise<NoteSearchResponse>;
  saveNote: (payload: {
    content: string;
    path: string;
  }) => Promise<{ content: string; path: string }>;
  setOpenNotePaths: (payload: { paths: string[] }) => Promise<void>;
  trackNoteSearchSelection: (payload: { notePath: string; query: string }) => Promise<void>;
};
