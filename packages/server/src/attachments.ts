import { mediaType } from "@octodo/engine";
import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import { Readable } from "node:stream";

/**
 * Task folders come from git and sync tools, so a file in one is untrusted. The sandbox keeps an
 * SVG or HTML file opened on its own from running script against the API on the same origin.
 */
const UNTRUSTED_FILE_HEADERS = {
  "Content-Security-Policy":
    "default-src 'none'; img-src 'self' data:; style-src 'unsafe-inline'; sandbox",
  "X-Content-Type-Options": "nosniff",
  "Cache-Control": "no-cache",
};

/** The file at `path` as a streamed response, or null when there is no regular file there. */
export const fileResponse = async (path: string): Promise<Response | null> => {
  const info = await stat(path).catch(() => null);
  if (info === null || !info.isFile()) return null;
  return new Response(Readable.toWeb(createReadStream(path)) as ReadableStream, {
    headers: {
      ...UNTRUSTED_FILE_HEADERS,
      "Content-Type": mediaType(path),
      "Content-Length": String(info.size),
    },
  });
};
