# Desktop Sidebar Plan

Goal: make the sidebar almost invisible while keeping it fully useful for browsing the vault.

## Principle

The sidebar is for browsing structure. It should not become a second command palette or a button shelf.

Visible controls:

- Sort

Everything else should be behavior, keyboard shortcut, or context menu.

## Sort

Add one compact sort button in the sidebar header.

Options:

- Alphabetical A-Z
- Alphabetical Z-A
- Modified newest first
- Modified oldest first
- Created newest first
- Created oldest first

Implementation notes:

- Use note metadata, not path strings.
- Add real created-time metadata before implementing created-date sort.
- Preserve folder-first behavior unless it creates surprising ordering.

## Active Note Behavior

When the sidebar opens:

- Highlight/select the active note.
- Expand ancestor folders for the active note.
- Reveal the active note in view.

When the active note changes while the sidebar is open:

- Follow the active note.
- Keep the tree focused on browsing, not search.

## Expansion State

Folders should remember expanded/collapsed state.

Preserve expansion across:

- Note save
- Rename
- Watcher refresh
- Sort change
- Drag/drop move where possible

Avoid full resets that make the tree forget what the user was browsing.

## Context Menu

Keep file operations contextual.

Right-click row actions:

- Rename
- Delete only if delete support is implemented cleanly

Do not add permanent toolbar buttons for:

- New note
- Search/filter
- Settings
- Refresh
- Collapse all
- More menu

## Implementation Steps

1. Wire note metadata through desktop IPC so the renderer can sort by path, modified time, and created time.
2. Add the single sort control to the sidebar header.
3. Pass the active note path into the file tree.
4. Select, expand to, and reveal the active note when the sidebar opens.
5. Preserve folder expansion across metadata refreshes and sort changes.
6. Add only cleanly supported context-menu actions.
7. Verify with typecheck/lint and a manual desktop sidebar check.

## Manual Check

- Opening the sidebar reveals the current note.
- The active note is highlighted.
- Sort modes work.
- Expanded folders stay expanded after refresh and sort changes.
- Rename and drag/drop move still work.
