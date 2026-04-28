import { BrowserWindow, Menu, type IpcMainInvokeEvent } from "electron";

export type TabMenuAction = "close" | "close-others" | "close-right" | null;

export function openTabMenu(
  event: IpcMainInvokeEvent,
  payload: { hasOthers: boolean; hasRight: boolean },
) {
  const window = BrowserWindow.fromWebContents(event.sender);
  if (!window) {
    return Promise.resolve<TabMenuAction>(null);
  }

  return new Promise<TabMenuAction>((resolve) => {
    let chosen: TabMenuAction = null;
    const menu = Menu.buildFromTemplate([
      {
        label: "Close",
        click: () => {
          chosen = "close";
        },
      },
      {
        label: "Close Others",
        enabled: payload.hasOthers,
        click: () => {
          chosen = "close-others";
        },
      },
      {
        label: "Close All to the Right",
        enabled: payload.hasRight,
        click: () => {
          chosen = "close-right";
        },
      },
    ]);
    menu.popup({
      window,
      callback: () => resolve(chosen),
    });
  });
}
