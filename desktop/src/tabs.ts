export type EditorTab =
  | {
      content: string;
      id: string;
      kind: "temp";
      label: string;
    }
  | {
      content: string;
      id: string;
      kind: "note";
      label: string;
      path: string;
    };

export interface TabState {
  activeTabId: string;
  tabs: EditorTab[];
}

let nextTempId = 0;

export function createTempTab(): EditorTab {
  nextTempId += 1;
  return {
    content: "",
    id: `temp:${Date.now()}:${nextTempId}`,
    kind: "temp",
    label: "-",
  };
}

export function createInitialTabState(): TabState {
  const tab = createTempTab();
  return {
    activeTabId: tab.id,
    tabs: [tab],
  };
}

export function createNoteTab(path: string, content: string): EditorTab {
  return {
    content,
    id: `note:${path}`,
    kind: "note",
    label: path.split("/").at(-1) ?? path,
    path,
  };
}

export function ensureOpenTab(state: TabState): TabState {
  if (state.tabs.length > 0) return state;
  return createInitialTabState();
}
