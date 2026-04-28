import { protocol } from "electron";
import { serveMediaFile } from "./media-response.js";

export type MediaFileResolver = {
  resolveMediaFile: (notePath: string, mediaPath: string) => Promise<string>;
};

export function registerVaultMediaScheme() {
  protocol.registerSchemesAsPrivileged([
    {
      scheme: "vault-media",
      privileges: {
        standard: true,
        secure: true,
        supportFetchAPI: true,
      },
    },
  ]);
}

export function createVaultMediaProtocolHandler(mediaResolver: MediaFileResolver) {
  return async function openMedia(request: Request) {
    try {
      const url = new URL(request.url);
      const mediaPath = url.searchParams.get("path");

      if (!mediaPath) {
        return new Response("Missing media path", { status: 400 });
      }

      const filePath = await mediaResolver.resolveMediaFile(
        url.searchParams.get("note") ?? "",
        mediaPath,
      );
      return serveMediaFile(request, filePath);
    } catch (mediaError: unknown) {
      const message = mediaError instanceof Error ? mediaError.message : String(mediaError);
      return new Response(message, { status: 404 });
    }
  };
}
