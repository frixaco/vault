import type { MouseEvent } from "react";
import { IconClose } from "./icon-close.js";
import { cn } from "./lib/utils.js";
import type { EditorTab } from "./tabs.js";

export function TabBar({
  activeTabId,
  onActivateTab,
  onCloseTab,
  onTabContextMenu,
  onTabMouseDown,
  tabs,
}: {
  activeTabId: string;
  onActivateTab: (id: string) => void;
  onCloseTab: (id: string) => void;
  onTabContextMenu: (event: MouseEvent, id: string) => void;
  onTabMouseDown: (event: MouseEvent, id: string) => void;
  tabs: EditorTab[];
}) {
  return (
    <nav
      className="editor-width pointer-events-none fixed bottom-0 left-1/2 z-10 flex h-tabbar -translate-x-1/2 items-center justify-center overflow-x-auto bg-transparent [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
      aria-label="Open notes"
    >
      {tabs.map((tab, index) => (
        <button
          key={tab.id}
          type="button"
          className={cn(
            "group relative flex h-full min-w-0 max-w-45 flex-none items-center overflow-hidden whitespace-nowrap bg-transparent font-vault-chrome text-[12px] tracking-normal text-fg-faint pointer-events-auto transition-colors duration-100 ease-vault hover:text-fg-muted aria-selected:text-fg",
            index > 0 &&
              "before:absolute before:top-3 before:bottom-3 before:left-0 before:w-px before:bg-hairline-strong before:content-['']",
            activeTabId === tab.id &&
              tabs.length > 1 &&
              "after:absolute after:right-0 after:bottom-0 after:left-0 after:h-0.5 after:bg-accent after:content-['']",
          )}
          aria-selected={activeTabId === tab.id}
          onClick={() => onActivateTab(tab.id)}
          onContextMenu={(event) => onTabContextMenu(event, tab.id)}
          onMouseDown={(event) => onTabMouseDown(event, tab.id)}
        >
          <span className="flex min-w-0 flex-1 items-center justify-center gap-1 pr-5 pl-2">
            <span
              className="inline-grid size-4 flex-none place-items-center overflow-hidden text-current opacity-0 transition-opacity duration-100 ease-vault group-hover:opacity-100 [&_.icon]:h-3 [&_.icon]:w-3"
              role="button"
              tabIndex={-1}
              aria-label={`Close ${tab.label}`}
              onClick={(event) => {
                event.stopPropagation();
                onCloseTab(tab.id);
              }}
            >
              <IconClose />
            </span>
            <span
              className={cn(
                "overflow-hidden flex-1 text-ellipsis text-center",
                activeTabId === tab.id ? "font-semibold" : "",
              )}
            >
              {tab.label}
            </span>
          </span>
        </button>
      ))}
    </nav>
  );
}
