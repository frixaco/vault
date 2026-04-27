import Image from "@tiptap/extension-image";
import { mergeAttributes, Node as TiptapNode } from "@tiptap/react";
import { getMediaKind } from "./media-types.js";

let currentMarkdownNotePath = "";

export function setCurrentMarkdownNotePath(notePath: string) {
  currentMarkdownNotePath = notePath;
}

function getVaultMediaUrl(notePath: string, mediaPath: string) {
  const params = new URLSearchParams({ path: mediaPath });
  if (notePath) params.set("note", notePath);
  return `vault-media://asset?${params.toString()}`;
}

function shouldServeFromVault(mediaPath: string) {
  return mediaPath.length > 0 && !/^(?:[a-z][a-z0-9+.-]*:|#)/i.test(mediaPath);
}

function formatMarkdownLinkTarget(target: string) {
  return /[\s()<>]/.test(target) ? `<${target}>` : target;
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
    const attrs = mergeAttributes({
      class: "vault-media",
      "data-vault-media-kind": kind,
      "data-vault-media-markdown-style": markdownStyle,
      "data-vault-media-markdown-title": markdownTitle,
      "data-vault-media-note-path": notePath,
      "data-vault-media-path": mediaPath,
      "data-vault-media-raw-target": rawTarget,
      src,
      title: rawTarget,
    });

    if (kind === "audio") {
      return ["audio", mergeAttributes(attrs, { controls: "true" })];
    }

    if (kind === "video") {
      return ["video", mergeAttributes(attrs, { controls: "true" })];
    }

    return ["img", mergeAttributes(attrs, { alt })];
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
    };
  },

  parseMarkdown: (token, helpers) => {
    const src = String(token.href ?? "");
    const vaultSrc = shouldServeFromVault(src) ? src : null;
    const vaultKind = vaultSrc ? getMediaKind(vaultSrc) : null;

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
});
