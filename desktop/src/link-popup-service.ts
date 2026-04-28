import { BrowserWindow, shell, type IpcMainInvokeEvent } from "electron";

export class ExternalLinkPopupService {
  async open(event: IpcMainInvokeEvent, rawUrl: string) {
    const url = parsePopupUrl(rawUrl);
    const parent = BrowserWindow.fromWebContents(event.sender) ?? undefined;
    const popup = new BrowserWindow({
      width: 550,
      height: 360,
      minWidth: 320,
      minHeight: 220,
      parent,
      title: url.hostname,
      backgroundColor: "#111111",
      webPreferences: {
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
      },
    });
    let wasClosed = false;

    popup.on("closed", () => {
      wasClosed = true;
    });

    popup.webContents.setWindowOpenHandler(({ url }) => {
      try {
        void shell.openExternal(parsePopupUrl(url).toString());
      } catch {
        // Ignore non-web popup requests from external pages.
      }
      return { action: "deny" };
    });

    try {
      await popup.loadURL(url.toString());
    } catch (error) {
      if (wasClosed || popup.isDestroyed()) return;
      throw error;
    }
  }
}

function parsePopupUrl(rawUrl: string) {
  const url = new URL(rawUrl);
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new Error("Only HTTP and HTTPS links can be opened in popup windows");
  }
  return url;
}
