import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import { Readable } from "node:stream";
import { getMediaMimeType } from "./media-types.js";

function createMediaResponse(filePath: string, options: { start: number; end: number }) {
  return Readable.toWeb(createReadStream(filePath, options)) as ReadableStream<Uint8Array>;
}

function invalidRangeResponse(fileSize: number) {
  return new Response(null, {
    headers: {
      "Accept-Ranges": "bytes",
      "Content-Range": `bytes */${fileSize}`,
    },
    status: 416,
  });
}

export async function serveMediaFile(request: Request, filePath: string) {
  const fileStat = await stat(filePath);
  const fileSize = fileStat.size;
  const contentType = getMediaMimeType(filePath);
  const rangeHeader = request.headers.get("range");

  if (!rangeHeader) {
    return new Response(
      request.method === "HEAD" || fileSize === 0
        ? null
        : createMediaResponse(filePath, { start: 0, end: fileSize - 1 }),
      {
        headers: {
          "Accept-Ranges": "bytes",
          "Content-Length": String(fileSize),
          "Content-Type": contentType,
        },
      },
    );
  }

  const rangeMatch = rangeHeader.match(/^bytes=(\d*)-(\d*)$/);
  if (!rangeMatch) return invalidRangeResponse(fileSize);

  const [, rangeStart = "", rangeEnd = ""] = rangeMatch;
  if (!rangeStart && !rangeEnd) return invalidRangeResponse(fileSize);

  let start: number;
  let end: number;

  if (!rangeStart) {
    const suffixLength = Number(rangeEnd);
    if (!Number.isSafeInteger(suffixLength) || suffixLength <= 0) {
      return invalidRangeResponse(fileSize);
    }
    start = Math.max(fileSize - suffixLength, 0);
    end = fileSize - 1;
  } else {
    start = Number(rangeStart);
    end = rangeEnd ? Number(rangeEnd) : fileSize - 1;
    if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end)) {
      return invalidRangeResponse(fileSize);
    }
  }

  if (start >= fileSize || end < start) return invalidRangeResponse(fileSize);
  end = Math.min(end, fileSize - 1);

  return new Response(
    request.method === "HEAD" ? null : createMediaResponse(filePath, { start, end }),
    {
      headers: {
        "Accept-Ranges": "bytes",
        "Content-Length": String(end - start + 1),
        "Content-Range": `bytes ${start}-${end}/${fileSize}`,
        "Content-Type": contentType,
      },
      status: 206,
    },
  );
}
