import StarterKit from "@tiptap/starter-kit";
import { EditorContent, useEditor } from "@tiptap/react";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";

function App() {
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

  return (
    <main className="app-shell">
      <div className="window-drag-region" aria-hidden="true" />
      <EditorContent editor={editor} />
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
