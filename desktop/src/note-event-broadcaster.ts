import { BrowserWindow } from "electron";
import type { NoteFileService } from "./note-file-service.js";

export function wireNoteFileEvents(noteFiles: NoteFileService) {
  noteFiles.onTreePatch((patch) => {
    sendToAllWindows("notes:tree-patch", patch);
  });
  noteFiles.onOpenNoteUpdated((event) => {
    sendToAllWindows("notes:open-note-updated", event);
  });
  noteFiles.onNoteDeleted((notePath) => {
    sendToAllWindows("notes:note-deleted", notePath);
  });
  noteFiles.onError((message) => {
    sendToAllWindows("notes:watch-error", message);
  });
}

function sendToAllWindows(channel: string, payload: unknown) {
  for (const window of BrowserWindow.getAllWindows()) {
    if (!window.isDestroyed()) {
      window.webContents.send(channel, payload);
    }
  }
}
