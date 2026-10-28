import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import { extname } from "node:path";
import { Readable } from "node:stream";

/** Attachments larger than this are refused on upload. */
export const MAX_ATTACHMENT_BYTES = 20 * 1024 * 1024;

const CONTENT_TYPES: Readonly<Record<string, string>> = {
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".webp": "image/webp",
  ".avif": "image/avif",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon",
  ".bmp": "image/bmp",
  ".pdf": "application/pdf",
  ".txt": "text/plain; charset=utf-8",
  ".md": "text/markdown; charset=utf-8",
  ".json": "application/json",
  ".csv": "text/csv; charset=utf-8",
  ".mp4": "video/mp4",
  ".webm": "video/webm",
  ".mp3": "audio/mpeg",
};

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
      "Content-Type": CONTENT_TYPES[extname(path).toLowerCase()] ?? "application/octet-stream",
      "Content-Length": String(info.size),
    },
  });
};
