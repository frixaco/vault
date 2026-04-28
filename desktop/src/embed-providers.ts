export type EmbedKind = "card" | "thumbnail";
export type EmbedProviderName = "twitter" | "youtube";

export interface EmbedDescriptor {
  kind: EmbedKind;
  openUrl: string;
  provider: EmbedProviderName;
  thumbnailUrl: string;
  title: string;
  url: string;
}

interface EmbedProvider {
  name: EmbedProviderName;
  parse: (url: URL, rawUrl: string, label: string) => EmbedDescriptor | null;
}

function parseYoutubeTimestamp(value: string | null) {
  if (!value) return null;

  const secondsMatch = value.match(/^(\d+)s?$/);
  if (secondsMatch) return Number(secondsMatch[1]);

  const timeMatch = value.match(/^(?:(\d+)h)?(?:(\d+)m)?(?:(\d+)s?)?$/);
  if (!timeMatch) return null;

  const hours = Number(timeMatch[1] ?? 0);
  const minutes = Number(timeMatch[2] ?? 0);
  const seconds = Number(timeMatch[3] ?? 0);
  const total = hours * 3600 + minutes * 60 + seconds;
  return total > 0 ? total : null;
}

function getYoutubeVideoId(url: URL) {
  const host = url.hostname.replace(/^www\./, "");
  let videoId: string | null = null;

  if (host === "youtu.be") {
    videoId = url.pathname.split("/").filter(Boolean)[0] ?? null;
  } else if (host === "youtube.com" || host === "m.youtube.com" || host === "music.youtube.com") {
    if (url.pathname === "/watch") {
      videoId = url.searchParams.get("v");
    } else {
      const [kind, id] = url.pathname.split("/").filter(Boolean);
      if (kind === "embed" || kind === "shorts" || kind === "live") videoId = id ?? null;
    }
  } else if (host === "youtube-nocookie.com") {
    const [kind, id] = url.pathname.split("/").filter(Boolean);
    if (kind === "embed") videoId = id ?? null;
  }

  if (!videoId || !/^[\w-]+$/.test(videoId)) return null;
  return videoId;
}

const youtubeProvider: EmbedProvider = {
  name: "youtube",
  parse(url, rawUrl, label) {
    const videoId = getYoutubeVideoId(url);
    if (!videoId) return null;

    const watchUrl = new URL("https://www.youtube.com/watch");
    watchUrl.searchParams.set("v", videoId);
    const start = parseYoutubeTimestamp(url.searchParams.get("start") ?? url.searchParams.get("t"));
    if (start) watchUrl.searchParams.set("t", `${start}s`);

    return {
      kind: "thumbnail",
      openUrl: watchUrl.toString(),
      provider: "youtube",
      thumbnailUrl: `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`,
      title: label || "YouTube video",
      url: rawUrl,
    };
  },
};

const twitterProvider: EmbedProvider = {
  name: "twitter",
  parse(url, rawUrl, label) {
    const host = url.hostname.replace(/^www\./, "");
    if (host !== "x.com" && host !== "twitter.com") return null;

    return {
      kind: "card",
      openUrl: rawUrl,
      provider: "twitter",
      thumbnailUrl: "",
      title: label || "Post on X",
      url: rawUrl,
    };
  },
};

const embedProviders: EmbedProvider[] = [youtubeProvider, twitterProvider];

export function getEmbedForUrl(rawUrl: string, label = "") {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    return null;
  }

  for (const provider of embedProviders) {
    const embed = provider.parse(url, rawUrl, label);
    if (embed) return embed;
  }

  return null;
}
