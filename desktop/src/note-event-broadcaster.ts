import { BrowserWindow } from "electron";
import type { NoteFileService } from "./note-file-service.js";

export function wireNoteFileEvents(noteFiles: NoteFileService) {
  const unlistenTreePatch = noteFiles.onTreePatch((patch) => {
    sendToAllWindows("notes:tree-patch", patch);
  });
  const unlistenOpenNoteUpdated = noteFiles.onOpenNoteUpdated((event) => {
    sendToAllWindows("notes:open-note-updated", event);
  });
  const unlistenNoteDeleted = noteFiles.onNoteDeleted((notePath) => {
    sendToAllWindows("notes:note-deleted", notePath);
  });
  const unlistenError = noteFiles.onError((message) => {
    sendToAllWindows("notes:watch-error", message);
  });

  return () => {
    unlistenTreePatch();
    unlistenOpenNoteUpdated();
    unlistenNoteDeleted();
    unlistenError();
  };
}

function sendToAllWindows(channel: string, payload: unknown) {
  for (const window of BrowserWindow.getAllWindows()) {
    if (!window.isDestroyed()) {
      window.webContents.send(channel, payload);
    }
  }
}
