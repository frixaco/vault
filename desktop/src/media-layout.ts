import type { MediaKind } from "./media-types.js";

export const MEDIA_LAYOUT_FILE_NAME = ".media-layout.json";
export const MEDIA_LAYOUT_VERSION = 1;

export type ResizableMediaKind = Extract<MediaKind, "image" | "video">;

export type MediaLayoutEntry = {
  fingerprint: string;
  kind: ResizableMediaKind;
  occurrence: number;
  target: string;
  updatedAt: string;
  width: number;
};

export type MediaLayoutFile = {
  media: MediaLayoutEntry[];
  version: typeof MEDIA_LAYOUT_VERSION;
};

export function createEmptyMediaLayout(): MediaLayoutFile {
  return {
    media: [],
    version: MEDIA_LAYOUT_VERSION,
  };
}
