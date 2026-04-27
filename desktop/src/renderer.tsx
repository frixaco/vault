import { FileTree, useFileTree } from "@pierre/trees/react";
import StarterKit from "@tiptap/starter-kit";
import { EditorContent, useEditor } from "@tiptap/react";
import { StrictMode, useEffect, useState } from "react";
import { createRoot } from "react-dom/client";

declare global {
  interface Window {
    vault: {
      listNotes: () => Promise<string[]>;
    };
  }
}

function App() {
  const [notes, setNotes] = useState<string[]>([]);
  const [status, setStatus] = useState("Loading notes...");
  const [error, setError] = useState<string | null>(null);
  const { model: noteTree } = useFileTree({
    flattenEmptyDirectories: true,
    initialExpansion: "open",
    itemHeight: 28,
    paths: [],
    search: true,
    stickyFolders: true,
    unsafeCSS: `
      button[data-type='item'] {
        border-radius: 6px;
        font-size: 13px;
      }
    `,
  });
  const editor = useEditor({
    autofocus: true,
    content: "",
    extensions: [StarterKit],
    editorProps: {
      attributes: {
        "aria-label": "Vault editor",
        class: "editor-surface",
      },
    },
    immediatelyRender: false,
  });

  useEffect(() => {
    let active = true;

    window.vault
      .listNotes()
      .then((files) => {
        if (!active) {
          return;
        }
        setNotes(files);
        setStatus(`${files.length} Markdown files`);
      })
      .catch((listError: unknown) => {
        if (!active) {
          return;
        }
        setError(listError instanceof Error ? listError.message : String(listError));
        setStatus("Could not load notes");
      });

    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    noteTree.resetPaths(notes);
  }, [noteTree, notes]);

  return (
    <main className="app-shell">
      <div className="window-drag-region" aria-hidden="true" />
      <aside className="notes-panel" aria-label="Notes">
        <header className="notes-panel-header">
          <h1>Vault</h1>
          <p>{status}</p>
        </header>
        {error ? <p className="notes-error">{error}</p> : null}
        <FileTree className="notes-tree" model={noteTree} />
      </aside>
      <section className="editor-pane">
        <EditorContent editor={editor} />
      </section>
    </main>
  );
}

const root = document.querySelector("#root");

if (!root) {
  throw new Error("Missing #root element");
}

createRoot(root).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
