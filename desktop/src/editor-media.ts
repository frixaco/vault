import Image from "@tiptap/extension-image";
import { mergeAttributes, Node as TiptapNode } from "@tiptap/react";
import type { ReactNodeViewProps } from "@tiptap/react";
import { getEmbedForUrl } from "./embed-providers.js";
import type { MediaLayoutEntry, MediaLayoutFile, ResizableMediaKind } from "./media-layout.js";
import { getMediaKind } from "./media-types.js";

let currentMarkdownNotePath = "";
let mediaLayoutCommitHandler: ((editor: Editor) => void) | null = null;

const RESIZE_MIN_WIDTH = 120;
const RESIZE_MAX_WIDTH = 2400;
const MEDIA_FINGERPRINT_CONTEXT = 160;

export const MEDIA_ACTION_TARGET_EVENT = "vault-media-action-target";
export const MEDIA_ACTION_LEAVE_EVENT = "vault-media-action-leave";

export type MediaActionTargetDetail = {
  kind: ResizableMediaKind;
  nodeSize: number;
  nodeType: MediaNodeKind;
  position: number;
  rect: {
    bottom: number;
    left: number;
    right: number;
    top: number;
  };
  target: string;
  width: number | null;
};

export function setCurrentMarkdownNotePath(notePath: string) {
  currentMarkdownNotePath = notePath;
}

export function setMediaLayoutCommitHandler(handler: ((editor: Editor) => void) | null) {
  mediaLayoutCommitHandler = handler;
}

export function collectEditorMediaLayout(editor: Editor): MediaLayoutFile {
  const updatedAt = new Date().toISOString();

  return {
    media: getMediaNodeDescriptors(editor)
      .map(({ fingerprint, kind, node, occurrence, target }): MediaLayoutEntry | null => {
        const width = parseMediaWidth(node.attrs.width);
        if (!width) return null;

        return {
          fingerprint,
          kind,
          occurrence,
          target,
          updatedAt,
          width,
        };
      })
      .filter((entry): entry is MediaLayoutEntry => entry !== null),
    version: 1,
  };
}

export function applyMediaLayoutToEditor(editor: Editor, layout: MediaLayoutFile) {
  const descriptors = getMediaNodeDescriptors(editor);
  const matcher = createMediaLayoutMatcher(layout);
  let transaction = editor.state.tr;

  for (const descriptor of descriptors) {
    const match = matcher(descriptor);
    const currentWidth = parseMediaWidth(descriptor.node.attrs.width);
    const nextWidth = match?.width ?? null;

    if (currentWidth === nextWidth) continue;

    transaction = transaction.setNodeMarkup(descriptor.position, undefined, {
      ...descriptor.node.attrs,
      width: nextWidth,
    });
  }

  if (!transaction.docChanged) return;
  editor.view.dispatch(transaction.setMeta("vaultMediaLayout", "apply"));
}

export function updateEditorMediaPath(editor: Editor, position: number, nextTarget: string) {
  const node = editor.state.doc.nodeAt(position);
  const nodeKind = getMediaNodeKind(node);
  if (!node || !nodeKind) return false;

  editor.view.dispatch(
    editor.state.tr
      .setNodeMarkup(position, undefined, {
        ...node.attrs,
        ...getEditedMediaAttributes(node, nodeKind, nextTarget),
      })
      .scrollIntoView(),
  );
  editor.view.focus();
  return true;
}

export function resetEditorMediaSize(editor: Editor, position: number) {
  const node = editor.state.doc.nodeAt(position);
  if (!node || !getMediaNodeKind(node)) return false;

  editor.view.dispatch(
    editor.state.tr
      .setNodeMarkup(position, undefined, {
        ...node.attrs,
        width: null,
      })
      .scrollIntoView(),
  );
  editor.view.focus();
  return true;
}

export function deleteEditorMedia(editor: Editor, position: number) {
  const node = editor.state.doc.nodeAt(position);
  if (!node || !getMediaNodeKind(node)) return false;

  editor.view.dispatch(editor.state.tr.delete(position, position + node.nodeSize).scrollIntoView());
  editor.view.focus();
  return true;
}

function getVaultMediaUrl(notePath: string, mediaPath: string) {
  const params = new URLSearchParams({ path: mediaPath });
  if (notePath) params.set("note", notePath);
  return `vault-media://asset?${params.toString()}`;
}

function shouldServeFromVault(mediaPath: string) {
  return mediaPath.length > 0 && !/^(?:[a-z][a-z0-9+.-]*:|#)/i.test(mediaPath);
}

function isDataImageSource(src: string) {
  return /^data:image\//i.test(src);
}

function shouldRenderAsImage(src: string, vaultSrc: string | null) {
  return Boolean(vaultSrc) || isDataImageSource(src);
}

function formatMarkdownLinkTarget(target: string) {
  return /[\s()<>]/.test(target) ? `<${target}>` : target;
}

function renderMediaSizeAttributes(width: unknown) {
  const parsedWidth = parseMediaWidth(width);
  return parsedWidth
    ? {
        "data-vault-media-width": String(parsedWidth),
        style: `width: ${parsedWidth}px;`,
      }
    : {};
}

function parseObsidianMediaTarget(target: string) {
  const [mediaPath = "", ...labelParts] = target.split("|");
  const label = labelParts.join("|").trim();

  return {
    label,
    mediaPath: mediaPath.trim(),
    rawTarget: target.trim(),
  };
}

export const VaultMedia = TiptapNode.create({
  name: "vaultMedia",
  group: "inline",
  inline: true,
  atom: true,
  draggable: true,

  addAttributes() {
    return {
      alt: { default: null },
      kind: { default: "image" },
      markdownStyle: { default: "obsidian" },
      markdownTitle: { default: "" },
      notePath: { default: "" },
      rawTarget: { default: "" },
      src: { default: null },
      path: { default: "" },
      width: { default: null },
    };
  },

  parseHTML() {
    return [
      {
        tag: "[data-vault-media-path]",
        getAttrs: (element) => {
          if (!(element instanceof HTMLElement)) return false;
          const mediaPath = element.getAttribute("data-vault-media-path") ?? "";
          const notePath = element.getAttribute("data-vault-media-note-path") ?? "";

          return {
            alt: element.getAttribute("alt") ?? element.textContent ?? mediaPath,
            kind:
              element.getAttribute("data-vault-media-kind") ?? getMediaKind(mediaPath) ?? "image",
            markdownStyle: element.getAttribute("data-vault-media-markdown-style") ?? "obsidian",
            markdownTitle: element.getAttribute("data-vault-media-markdown-title") ?? "",
            notePath,
            rawTarget: element.getAttribute("data-vault-media-raw-target") ?? mediaPath,
            src: element.getAttribute("src") ?? getVaultMediaUrl(notePath, mediaPath),
            path: mediaPath,
            width: parseMediaWidth(
              element.getAttribute("data-vault-media-width") ?? element.getAttribute("width"),
            ),
          };
        },
      },
    ];
  },

  renderHTML({ HTMLAttributes }) {
    const mediaPath = String(HTMLAttributes.path ?? "");
    const notePath = String(HTMLAttributes.notePath ?? "");
    const rawTarget = String(HTMLAttributes.rawTarget || mediaPath);
    const kind = String(HTMLAttributes.kind || getMediaKind(mediaPath) || "image");
    const markdownStyle = String(HTMLAttributes.markdownStyle || "obsidian");
    const markdownTitle = String(HTMLAttributes.markdownTitle || "");
    const src = String(HTMLAttributes.src || getVaultMediaUrl(notePath, mediaPath));
    const alt = String(HTMLAttributes.alt || mediaPath);
    const attrs = mergeAttributes(
      {
        class: "vault-media",
        "data-vault-media-kind": kind,
        "data-vault-media-markdown-style": markdownStyle,
        "data-vault-media-markdown-title": markdownTitle,
        "data-vault-media-note-path": notePath,
        "data-vault-media-path": mediaPath,
        "data-vault-media-raw-target": rawTarget,
        src,
        title: rawTarget,
      },
      renderMediaSizeAttributes(HTMLAttributes.width),
    );

    if (kind === "audio") {
      return [
        "span",
        { class: "vault-media-block" },
        ["audio", mergeAttributes(attrs, { controls: "true" })],
      ];
    }

    if (kind === "video") {
      return [
        "span",
        { class: "vault-media-block" },
        ["video", mergeAttributes(attrs, { controls: "true" })],
      ];
    }

    return ["span", { class: "vault-media-block" }, ["img", mergeAttributes(attrs, { alt })]];
  },

  markdownTokenName: "vaultMedia",

  markdownTokenizer: {
    name: "vaultMedia",
    level: "inline",
    start: (src: string) => src.indexOf("![["),
    tokenize(src: string) {
      const match = src.match(/^!\[\[([^\]\n]+)\]\]/);
      if (!match) return undefined;

      const { label, mediaPath, rawTarget } = parseObsidianMediaTarget(match[1] ?? "");
      const kind = getMediaKind(mediaPath);
      if (!kind) return undefined;

      return {
        type: "vaultMedia",
        raw: match[0],
        attributes: {
          alt: label || mediaPath,
          kind,
          markdownStyle: "obsidian",
          markdownTitle: "",
          notePath: currentMarkdownNotePath,
          rawTarget,
          src: getVaultMediaUrl(currentMarkdownNotePath, mediaPath),
          path: mediaPath,
        },
      };
    },
  },

  parseMarkdown: (token, helpers) => helpers.createNode("vaultMedia", token.attributes),

  renderMarkdown: (node) => {
    const rawTarget = node.attrs?.rawTarget || node.attrs?.path || "";
    if (node.attrs?.markdownStyle === "image") {
      const alt = node.attrs?.alt ?? "";
      const title = node.attrs?.markdownTitle ?? "";
      const target = formatMarkdownLinkTarget(rawTarget);
      return title ? `![${alt}](${target} "${title}")` : `![${alt}](${target})`;
    }

    return `![[${rawTarget}]]`;
  },

  addNodeView() {
    return (props) => createResizableMediaNodeView({ ...props, nodeKind: "vaultMedia" });
  },
});

export const VaultImage = Image.extend({
  addAttributes() {
    return {
      ...this.parent?.(),
      vaultNotePath: {
        default: "",
      },
      vaultSrc: {
        default: null,
      },
      width: {
        default: null,
        parseHTML: (element) =>
          parseMediaWidth(
            element.getAttribute("data-vault-media-width") ?? element.getAttribute("width"),
          ),
        renderHTML: (attributes) => renderMediaSizeAttributes(attributes.width),
      },
    };
  },

  parseMarkdown: (token, helpers) => {
    const src = String(token.href ?? "");
    const vaultSrc = shouldServeFromVault(src) ? src : null;
    const vaultKind = vaultSrc ? getMediaKind(vaultSrc) : null;
    const embed = getEmbedForUrl(src, token.text);

    if (embed) {
      return helpers.createNode("vaultEmbed", {
        alt: token.text,
        kind: embed.kind,
        markdownStyle: "image",
        markdownTitle: token.title ?? "",
        openUrl: embed.openUrl,
        provider: embed.provider,
        thumbnailUrl: embed.thumbnailUrl,
        title: token.text || token.title || embed.title,
        url: embed.url,
      });
    }

    if (vaultSrc && vaultKind && vaultKind !== "image") {
      return helpers.createNode("vaultMedia", {
        alt: token.text,
        kind: vaultKind,
        markdownStyle: "image",
        markdownTitle: token.title ?? "",
        notePath: currentMarkdownNotePath,
        rawTarget: vaultSrc,
        src: getVaultMediaUrl(currentMarkdownNotePath, vaultSrc),
        path: vaultSrc,
      });
    }

    if (!shouldRenderAsImage(src, vaultSrc)) {
      return helpers.createTextNode(token.text || src, [
        {
          attrs: {
            href: src,
            title: token.title || null,
          },
          type: "link",
        },
      ]);
    }

    return helpers.createNode("image", {
      alt: token.text,
      src: vaultSrc ? getVaultMediaUrl(currentMarkdownNotePath, vaultSrc) : src,
      title: token.title,
      vaultNotePath: vaultSrc ? currentMarkdownNotePath : "",
      vaultSrc,
    });
  },

  renderMarkdown: (node) => {
    const src = node.attrs?.vaultSrc ?? node.attrs?.src ?? "";
    const alt = node.attrs?.alt ?? "";
    const title = node.attrs?.title ?? "";

    return title ? `![${alt}](${src} "${title}")` : `![${alt}](${src})`;
  },

  renderHTML({ HTMLAttributes }) {
    return [
      "span",
      { class: "vault-media-block" },
      ["img", mergeAttributes(this.options.HTMLAttributes, HTMLAttributes)],
    ];
  },

  addNodeView() {
    return (props) => createResizableMediaNodeView({ ...props, nodeKind: "image" });
  },
});

type Editor = ReactNodeViewProps["editor"];
type ProseMirrorNode = ReactNodeViewProps["node"];
type MediaNodeView = {
  destroy?: () => void;
  deselectNode?: () => void;
  dom: HTMLElement;
  ignoreMutation?: () => boolean;
  selectNode?: () => void;
  stopEvent?: (event: Event) => boolean;
  update?: (node: ProseMirrorNode) => boolean;
};

type MediaNodeDescriptor = {
  fingerprint: string;
  kind: ResizableMediaKind;
  node: ProseMirrorNode;
  occurrence: number;
  position: number;
  target: string;
};

type MediaNodeInfo = {
  kind: ResizableMediaKind;
  target: string;
};

type MediaNodeKind = "image" | "vaultMedia";

type ResizableMediaNodeViewProps = {
  editor: Editor;
  getPos: ReactNodeViewProps["getPos"];
  node: ProseMirrorNode;
  nodeKind: MediaNodeKind;
};

function getMediaNodeDescriptors(editor: Editor) {
  const descriptors: MediaNodeDescriptor[] = [];
  const occurrenceByKey = new Map<string, number>();

  editor.state.doc.descendants((node, position) => {
    const info = getMediaNodeInfo(node);
    if (!info) return;

    const occurrenceKey = getMediaTargetKey(info);
    const occurrence = occurrenceByKey.get(occurrenceKey) ?? 0;
    occurrenceByKey.set(occurrenceKey, occurrence + 1);

    descriptors.push({
      ...info,
      fingerprint: createMediaFingerprint(editor.state.doc, position, node, info),
      node,
      occurrence,
      position,
    });
  });

  return descriptors;
}

function createMediaLayoutMatcher(layout: MediaLayoutFile) {
  const entriesByFingerprint = new Map<string, MediaLayoutEntry>();
  const entriesByOccurrence = new Map<string, MediaLayoutEntry>();
  const entriesByTarget = new Map<string, MediaLayoutEntry[]>();

  for (const entry of layout.media) {
    entriesByFingerprint.set(getMediaFingerprintKey(entry), entry);
    entriesByOccurrence.set(getMediaOccurrenceKey(entry), entry);

    const targetKey = getMediaTargetKey(entry);
    entriesByTarget.set(targetKey, [...(entriesByTarget.get(targetKey) ?? []), entry]);
  }

  return (descriptor: MediaNodeDescriptor) => {
    const fingerprintMatch = entriesByFingerprint.get(getMediaFingerprintKey(descriptor));
    if (fingerprintMatch) return fingerprintMatch;

    const occurrenceMatch = entriesByOccurrence.get(getMediaOccurrenceKey(descriptor));
    if (occurrenceMatch) return occurrenceMatch;

    const targetMatches = entriesByTarget.get(getMediaTargetKey(descriptor)) ?? [];
    return targetMatches.length === 1 ? targetMatches[0] : null;
  };
}

function createResizableMediaNodeView({
  editor,
  getPos,
  node,
  nodeKind,
}: ResizableMediaNodeViewProps): MediaNodeView {
  let currentNode = node;
  let selected = false;
  let mediaElement: HTMLImageElement | HTMLVideoElement | HTMLAudioElement | null = null;

  const dom = document.createElement("span");
  dom.className = "vault-media-block vault-media-node";
  dom.contentEditable = "false";

  const resizeHandle = document.createElement("span");
  resizeHandle.className = "vault-media-ui vault-media-resize-handle";
  resizeHandle.setAttribute("aria-label", "Resize media");
  resizeHandle.setAttribute("role", "button");
  resizeHandle.tabIndex = 0;

  const widthBadge = document.createElement("span");
  widthBadge.className = "vault-media-ui vault-media-width-badge";

  dom.append(resizeHandle);
  dom.append(widthBadge);

  dom.addEventListener("click", emitCurrentMediaActionTarget);
  dom.addEventListener("focusin", emitCurrentMediaActionTarget);
  dom.addEventListener("pointerenter", emitCurrentMediaActionTarget);
  dom.addEventListener("pointerleave", emitMediaActionLeave);
  resizeHandle.addEventListener("pointerdown", startResize);
  render();

  return {
    destroy() {
      dom.removeEventListener("click", emitCurrentMediaActionTarget);
      dom.removeEventListener("focusin", emitCurrentMediaActionTarget);
      dom.removeEventListener("pointerenter", emitCurrentMediaActionTarget);
      dom.removeEventListener("pointerleave", emitMediaActionLeave);
      resizeHandle.removeEventListener("pointerdown", startResize);
    },
    deselectNode() {
      selected = false;
      dom.classList.remove("is-selected");
    },
    dom,
    ignoreMutation() {
      return true;
    },
    selectNode() {
      selected = true;
      dom.classList.add("is-selected");
    },
    stopEvent(event: Event) {
      return event.target instanceof Element && event.target.closest(".vault-media-ui") !== null;
    },
    update(nextNode: ProseMirrorNode) {
      if (nextNode.type !== currentNode.type) return false;

      currentNode = nextNode;
      render();
      if (selected) dom.classList.add("is-selected");
      return true;
    },
  };

  function render() {
    const info = getMediaNodeInfo(currentNode);
    const kind = getRenderedMediaKind(currentNode);
    const nextMediaElement = createMediaElement(kind);

    mediaElement?.remove();
    mediaElement = nextMediaElement;
    dom.insertBefore(mediaElement, resizeHandle);

    dom.dataset.kind = kind;
    dom.dataset.resizable = info ? "true" : "false";

    applyMediaAttributes(mediaElement, currentNode, nodeKind);
    applyWidth(parseMediaWidth(currentNode.attrs.width));
  }

  function startResize(event: PointerEvent) {
    if (!getMediaNodeInfo(currentNode) || !mediaElement) return;

    event.preventDefault();
    event.stopPropagation();
    resizeHandle.setPointerCapture(event.pointerId);

    const startX = event.clientX;
    const startWidth =
      parseMediaWidth(currentNode.attrs.width) ?? mediaElement.getBoundingClientRect().width;
    const maxWidth = getResizeMaxWidth();
    let nextWidth = startWidth;

    dom.classList.add("is-resizing");
    updateWidthBadge(startWidth);

    function move(pointerEvent: PointerEvent) {
      nextWidth = clampWidth(startWidth + pointerEvent.clientX - startX, maxWidth);
      applyWidth(nextWidth);
      updateWidthBadge(nextWidth);
    }

    function end(pointerEvent: PointerEvent) {
      move(pointerEvent);
      dom.classList.remove("is-resizing");
      resizeHandle.releasePointerCapture(event.pointerId);
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", end);
      updateNodeAttributes({ width: nextWidth });
      queueMediaLayoutCommit(editor);
    }

    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", end, { once: true });
  }

  function getNodePosition() {
    if (typeof getPos !== "function") return null;

    const position = getPos();
    return typeof position === "number" ? position : null;
  }

  function updateNodeAttributes(attributes: Record<string, unknown>) {
    const position = getNodePosition();
    if (position === null) return;

    editor.view.dispatch(
      editor.state.tr.setNodeMarkup(position, undefined, {
        ...currentNode.attrs,
        ...attributes,
      }),
    );
  }

  function getResizeMaxWidth() {
    const editorSurface = dom.closest(".editor-surface");
    const width = editorSurface?.getBoundingClientRect().width ?? RESIZE_MAX_WIDTH;
    return Math.max(RESIZE_MIN_WIDTH, Math.min(RESIZE_MAX_WIDTH, width));
  }

  function applyWidth(width: number | null) {
    if (width) {
      dom.style.setProperty("--vault-media-width", `${width}px`);
      return;
    }

    dom.style.removeProperty("--vault-media-width");
    widthBadge.textContent = "";
  }

  function updateWidthBadge(width: number) {
    widthBadge.textContent = `${Math.round(width)} px`;
  }

  function emitCurrentMediaActionTarget() {
    const position = getNodePosition();
    const info = getMediaNodeInfo(currentNode);
    if (position === null || !info) return;

    const rect = dom.getBoundingClientRect();
    dom.dispatchEvent(
      new CustomEvent<MediaActionTargetDetail>(MEDIA_ACTION_TARGET_EVENT, {
        bubbles: true,
        detail: {
          kind: info.kind,
          nodeSize: currentNode.nodeSize,
          nodeType: nodeKind,
          position,
          rect: {
            bottom: rect.bottom,
            left: rect.left,
            right: rect.right,
            top: rect.top,
          },
          target: getEditableMediaTarget(currentNode),
          width: parseMediaWidth(currentNode.attrs.width),
        },
      }),
    );
  }

  function emitMediaActionLeave() {
    dom.dispatchEvent(
      new CustomEvent(MEDIA_ACTION_LEAVE_EVENT, {
        bubbles: true,
        detail: {
          position: getNodePosition(),
        },
      }),
    );
  }
}

function createMediaElement(kind: "audio" | "image" | "video") {
  if (kind === "video") {
    const video = document.createElement("video");
    video.controls = true;
    return video;
  }

  if (kind === "audio") {
    const audio = document.createElement("audio");
    audio.controls = true;
    return audio;
  }

  return document.createElement("img");
}

function applyMediaAttributes(
  mediaElement: HTMLImageElement | HTMLVideoElement | HTMLAudioElement,
  node: ProseMirrorNode,
  nodeKind: MediaNodeKind,
) {
  const attrs = node.attrs;
  const mediaPath = String(attrs.path ?? attrs.vaultSrc ?? attrs.src ?? "");
  const notePath = String(attrs.notePath ?? attrs.vaultNotePath ?? currentMarkdownNotePath);
  const rawTarget = String(attrs.rawTarget || mediaPath);
  const kind = getRenderedMediaKind(node);
  const src = String(attrs.src || getVaultMediaUrl(notePath, mediaPath));

  mediaElement.className = "vault-media";
  mediaElement.setAttribute("data-vault-media-kind", kind);
  mediaElement.setAttribute("data-vault-media-path", mediaPath);
  mediaElement.setAttribute("data-vault-media-raw-target", rawTarget);
  mediaElement.setAttribute("src", src);
  mediaElement.setAttribute("title", rawTarget);

  if (nodeKind === "vaultMedia") {
    mediaElement.setAttribute(
      "data-vault-media-markdown-style",
      String(attrs.markdownStyle || "obsidian"),
    );
    mediaElement.setAttribute("data-vault-media-markdown-title", String(attrs.markdownTitle || ""));
    mediaElement.setAttribute("data-vault-media-note-path", notePath);
  }

  const width = parseMediaWidth(attrs.width);
  if (width) mediaElement.setAttribute("data-vault-media-width", String(width));
  else mediaElement.removeAttribute("data-vault-media-width");

  if (mediaElement instanceof HTMLImageElement) {
    mediaElement.alt = String(attrs.alt || mediaPath);
  }
}

function getEditedMediaAttributes(
  node: ProseMirrorNode,
  nodeKind: MediaNodeKind,
  nextTarget: string,
) {
  const currentTarget = getEditableMediaTarget(node);
  const nextKind = getMediaKind(nextTarget) ?? getRenderedMediaKind(node);

  if (nodeKind === "vaultMedia") {
    return {
      alt: node.attrs.alt === currentTarget ? nextTarget : node.attrs.alt,
      kind: nextKind,
      path: nextTarget,
      rawTarget: nextTarget,
      src: getVaultMediaUrl(String(node.attrs.notePath ?? currentMarkdownNotePath), nextTarget),
    };
  }

  const vaultSrc = shouldServeFromVault(nextTarget) ? nextTarget : null;
  return {
    alt: node.attrs.alt === currentTarget ? nextTarget : node.attrs.alt,
    src: vaultSrc
      ? getVaultMediaUrl(String(node.attrs.vaultNotePath ?? currentMarkdownNotePath), vaultSrc)
      : nextTarget,
    vaultNotePath: vaultSrc ? String(node.attrs.vaultNotePath ?? currentMarkdownNotePath) : "",
    vaultSrc,
  };
}

function getMediaNodeKind(node: ProseMirrorNode | null): MediaNodeKind | null {
  if (node?.type.name === "image") return "image";
  if (node?.type.name === "vaultMedia") return "vaultMedia";
  return null;
}

function getEditableMediaTarget(node: ProseMirrorNode) {
  if (node.type.name === "vaultMedia") return String(node.attrs.path || node.attrs.rawTarget || "");
  if (node.type.name === "image") return String(node.attrs.vaultSrc ?? node.attrs.src ?? "");
  return "";
}

function getRenderedMediaKind(node: ProseMirrorNode) {
  if (node.type.name === "image") return "image";

  const kind = String(node.attrs.kind || getMediaKind(String(node.attrs.path ?? "")) || "image");
  if (kind === "audio" || kind === "video") return kind;
  return "image";
}

function getMediaNodeInfo(node: ProseMirrorNode): MediaNodeInfo | null {
  if (node.type.name === "image") {
    const target = String(node.attrs.vaultSrc ?? node.attrs.src ?? "");
    return target ? { kind: "image", target } : null;
  }

  if (node.type.name !== "vaultMedia") return null;

  const kind = String(node.attrs.kind || getMediaKind(String(node.attrs.path ?? "")) || "image");
  if (!isResizableMediaKind(kind)) return null;

  const target = String(node.attrs.path || node.attrs.rawTarget || "");
  return target ? { kind, target } : null;
}

function isResizableMediaKind(kind: string): kind is ResizableMediaKind {
  return kind === "image" || kind === "video";
}

function createMediaFingerprint(
  doc: ProseMirrorNode,
  position: number,
  node: ProseMirrorNode,
  info: MediaNodeInfo,
) {
  const beforeStart = Math.max(0, position - MEDIA_FINGERPRINT_CONTEXT);
  const afterEnd = Math.min(doc.content.size, position + node.nodeSize + MEDIA_FINGERPRINT_CONTEXT);
  const before = doc
    .textBetween(beforeStart, position, "\n", "\n")
    .slice(-MEDIA_FINGERPRINT_CONTEXT);
  const after = doc
    .textBetween(position + node.nodeSize, afterEnd, "\n", "\n")
    .slice(0, MEDIA_FINGERPRINT_CONTEXT);

  return hashMediaFingerprint(`${info.kind}\n${info.target}\n${before}\n${after}`);
}

function hashMediaFingerprint(value: string) {
  let hash = 0x811c9dc5;

  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }

  return (hash >>> 0).toString(16).padStart(8, "0");
}

function getMediaTargetKey({ kind, target }: Pick<MediaLayoutEntry, "kind" | "target">) {
  return `${kind}:${target}`;
}

function getMediaOccurrenceKey({
  kind,
  occurrence,
  target,
}: Pick<MediaLayoutEntry, "kind" | "occurrence" | "target">) {
  return `${getMediaTargetKey({ kind, target })}:${occurrence}`;
}

function getMediaFingerprintKey({
  fingerprint,
  kind,
  target,
}: Pick<MediaLayoutEntry, "fingerprint" | "kind" | "target">) {
  return `${getMediaTargetKey({ kind, target })}:${fingerprint}`;
}

function parseMediaWidth(value: unknown) {
  if (typeof value === "string" && value.trim().length === 0) return null;

  const width = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(width) || width <= 0) return null;
  return Math.round(width);
}

function clampWidth(width: number, maxWidth: number) {
  return Math.round(Math.min(Math.max(width, RESIZE_MIN_WIDTH), maxWidth));
}

function queueMediaLayoutCommit(editor: Editor) {
  queueMicrotask(() => {
    mediaLayoutCommitHandler?.(editor);
  });
}
