export type MediaKind = "audio" | "image" | "video";

export interface AttachmentsMigrationResult {
  attachmentsDirectory: string;
  copiedFiles: number;
  dryRun: boolean;
  missingFiles: string[];
  noteAssetsRoot: string;
  notesChanged: number;
  notesScanned: number;
  referencesFound: number;
  renamedFiles: number;
  skippedExistingFiles: number;
}

export const imageMediaExtensions = new Set(["avif", "gif", "jpeg", "jpg", "png", "svg", "webp"]);
export const audioMediaExtensions = new Set(["aac", "flac", "m4a", "mp3", "oga", "ogg", "wav"]);
export const videoMediaExtensions = new Set(["m4v", "mov", "mp4", "ogv", "webm"]);

export const mediaMimeTypes = new Map([
  ["aac", "audio/aac"],
  ["avif", "image/avif"],
  ["flac", "audio/flac"],
  ["gif", "image/gif"],
  ["jpeg", "image/jpeg"],
  ["jpg", "image/jpeg"],
  ["m4a", "audio/mp4"],
  ["m4v", "video/mp4"],
  ["mov", "video/quicktime"],
  ["mp3", "audio/mpeg"],
  ["mp4", "video/mp4"],
  ["oga", "audio/ogg"],
  ["ogg", "audio/ogg"],
  ["ogv", "video/ogg"],
  ["png", "image/png"],
  ["svg", "image/svg+xml"],
  ["wav", "audio/wav"],
  ["webm", "video/webm"],
  ["webp", "image/webp"],
]);

export const mediaExtensions = new Set(mediaMimeTypes.keys());

export function getMediaExtension(filePath: string) {
  return filePath.split(/[?#]/, 1)[0]?.split(".").at(-1)?.toLowerCase() ?? "";
}

export function getMediaKind(mediaPath: string): MediaKind | null {
  const extension = getMediaExtension(mediaPath);

  if (imageMediaExtensions.has(extension)) return "image";
  if (audioMediaExtensions.has(extension)) return "audio";
  if (videoMediaExtensions.has(extension)) return "video";
  return null;
}

export function getMediaMimeType(filePath: string) {
  return mediaMimeTypes.get(getMediaExtension(filePath)) ?? "application/octet-stream";
}

export function isMediaPath(filePath: string) {
  return mediaExtensions.has(getMediaExtension(filePath));
}
