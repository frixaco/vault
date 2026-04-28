import Link from "@tiptap/extension-link";
import { mergeAttributes, Node as TiptapNode } from "@tiptap/react";
import { getEmbedForUrl } from "./embed-providers.js";

function formatMarkdownLinkTarget(target: string) {
  return /[\s()<>]/.test(target) ? `<${target}>` : target;
}

function createPreviewImage(thumbnailUrl: string) {
  const image = document.createElement("img");
  image.alt = "";
  image.decoding = "async";
  image.loading = "lazy";
  image.src = thumbnailUrl;
  return image;
}

function openPopupUrl(url: string) {
  void window.vault.openPopup(url);
}

export const VaultEmbed = TiptapNode.create({
  name: "vaultEmbed",
  group: "inline",
  inline: true,
  atom: true,
  draggable: true,

  addAttributes() {
    return {
      alt: { default: "" },
      kind: { default: "card" },
      markdownStyle: { default: "image" },
      markdownTitle: { default: "" },
      openUrl: { default: "" },
      provider: { default: "" },
      thumbnailUrl: { default: "" },
      title: { default: "" },
      url: { default: "" },
    };
  },

  parseHTML() {
    return [
      {
        tag: "[data-vault-embed-url]",
        getAttrs: (element) => {
          if (!(element instanceof HTMLElement)) return false;
          const url = element.getAttribute("data-vault-embed-url") ?? "";
          const embed = getEmbedForUrl(url, element.getAttribute("data-vault-embed-alt") ?? "");
          if (!embed) return false;

          return {
            alt: element.getAttribute("data-vault-embed-alt") ?? "",
            kind: element.getAttribute("data-vault-embed-kind") ?? embed.kind,
            markdownStyle: element.getAttribute("data-vault-embed-markdown-style") ?? "image",
            markdownTitle: element.getAttribute("data-vault-embed-markdown-title") ?? "",
            openUrl: element.getAttribute("data-vault-embed-open-url") ?? embed.openUrl,
            provider: element.getAttribute("data-vault-embed-provider") ?? embed.provider,
            thumbnailUrl: element.getAttribute("data-vault-embed-thumbnail") ?? embed.thumbnailUrl,
            title: element.getAttribute("title") ?? embed.title,
            url,
          };
        },
      },
    ];
  },

  renderHTML({ HTMLAttributes }) {
    const kind = String(HTMLAttributes.kind ?? "card");
    const provider = String(HTMLAttributes.provider ?? "");
    const url = String(HTMLAttributes.url ?? "");
    const openUrl = String(HTMLAttributes.openUrl || url);
    const thumbnailUrl = String(HTMLAttributes.thumbnailUrl ?? "");
    const title = String(HTMLAttributes.title || HTMLAttributes.alt || url);
    const attrs = {
      class: `vault-embed vault-embed-${kind} vault-embed-${provider}`,
      "data-vault-embed-alt": String(HTMLAttributes.alt ?? ""),
      "data-vault-embed-kind": kind,
      "data-vault-embed-markdown-style": String(HTMLAttributes.markdownStyle ?? "image"),
      "data-vault-embed-markdown-title": String(HTMLAttributes.markdownTitle ?? ""),
      "data-vault-embed-open-url": openUrl,
      "data-vault-embed-provider": provider,
      "data-vault-embed-thumbnail": thumbnailUrl,
      "data-vault-embed-url": url,
      title,
    };

    if (kind === "thumbnail") {
      return [
        "a",
        mergeAttributes(attrs, { href: openUrl }),
        ["img", { alt: title, src: thumbnailUrl }],
      ];
    }

    return ["a", mergeAttributes(attrs, { href: url }), title];
  },

  addNodeView() {
    return ({ node }) => {
      const kind = String(node.attrs.kind ?? "card");
      const provider = String(node.attrs.provider ?? "");
      const url = String(node.attrs.url ?? "");
      const openUrl = String(node.attrs.openUrl || url);
      const thumbnailUrl = String(node.attrs.thumbnailUrl ?? "");
      const title = String(node.attrs.title || node.attrs.alt || url);
      const dom = document.createElement("span");
      dom.className = `vault-embed vault-embed-${kind} vault-embed-${provider}`;
      dom.contentEditable = "false";

      if (kind === "thumbnail") {
        const button = document.createElement("button");
        button.type = "button";
        button.className = "vault-embed-preview-button";
        button.setAttribute("aria-label", `Open ${title}`);

        if (thumbnailUrl) button.append(createPreviewImage(thumbnailUrl));

        const play = document.createElement("span");
        play.className = "vault-embed-play";
        play.setAttribute("aria-hidden", "true");
        button.append(play);

        button.addEventListener("click", () => openPopupUrl(openUrl));

        dom.append(button);
        return { dom };
      }

      const card = document.createElement("button");
      card.type = "button";
      card.className = "vault-embed-card";
      card.addEventListener("click", () => openPopupUrl(openUrl));

      const providerLabel = document.createElement("span");
      providerLabel.className = "vault-embed-card-provider";
      providerLabel.textContent = provider || "link";

      const titleLabel = document.createElement("span");
      titleLabel.className = "vault-embed-card-title";
      titleLabel.textContent = title;

      card.append(providerLabel, titleLabel);
      dom.append(card);
      return { dom };
    };
  },

  renderMarkdown: (node) => {
    const url = node.attrs?.url ?? "";
    const alt = node.attrs?.alt ?? "";
    const markdownStyle = node.attrs?.markdownStyle ?? "image";
    const title = node.attrs?.markdownTitle ?? "";
    const target = formatMarkdownLinkTarget(url);
    if (markdownStyle === "autolink") return url;
    return title ? `![${alt}](${target} "${title}")` : `![${alt}](${target})`;
  },
});

export const VaultLink = Link.extend({
  parseMarkdown: (token, helpers) => {
    const href = String(token.href ?? "");
    const text = String(token.text ?? "");
    const embed = text === href ? getEmbedForUrl(href, text) : null;

    if (embed) {
      return helpers.createNode("vaultEmbed", {
        alt: text,
        kind: embed.kind,
        markdownStyle: "autolink",
        markdownTitle: token.title ?? "",
        openUrl: embed.openUrl,
        provider: embed.provider,
        thumbnailUrl: embed.thumbnailUrl,
        title: embed.title,
        url: embed.url,
      });
    }

    return helpers.applyMark("link", helpers.parseInline(token.tokens || []), {
      href: token.href,
      title: token.title || null,
    });
  },
});
