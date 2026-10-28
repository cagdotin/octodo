import { AttachmentTooLarge, type AttachmentFile } from "@octodo/contract";
import { MAX_ATTACHMENT_BYTES } from "@octodo/contract/rules";
import { Effect, Stream } from "effect";
import {
  HttpServerRequest,
  HttpServerRespondable,
  HttpServerResponse,
  HttpStaticServer,
} from "effect/http";
import { basename, dirname } from "node:path";
import { pathToFileURL } from "node:url";

/**
 * Task folders come from git and sync tools, so a file in one is untrusted. The sandbox keeps an
 * SVG or HTML file opened on its own from running script against the API on the same origin.
 */
const UNTRUSTED_FILE_HEADERS = {
  "Content-Security-Policy":
    "default-src 'none'; img-src 'self' data:; style-src 'unsafe-inline'; sandbox",
  "X-Content-Type-Options": "nosniff",
};

/** Types a browser would open as a page rather than show; they download instead. */
const PAGE_TYPES =
  /^(text\/html|application\/xhtml\+xml|image\/svg\+xml|text\/xml|application\/xml)\b/;

/**
 * Streams an attachment from disk with its media type, answering `Range`, `ETag` and `304` the
 * way static files are answered, and with the headers of an untrusted file (decision 0006).
 * `Content-Location` is the file on this computer, which a client in server mode passes on as
 * `read_attachment` does (decision 0018).
 */
export const serveAttachment = (attachment: AttachmentFile) =>
  Effect.gen(function* () {
    const request = yield* HttpServerRequest.HttpServerRequest;
    const name = basename(attachment.file);
    const serve = yield* HttpStaticServer.make({
      root: dirname(attachment.file),
      index: undefined,
      cacheControl: "no-cache",
    });
    const response = yield* serve.pipe(
      Effect.provideService(
        HttpServerRequest.HttpServerRequest,
        request.modify({ url: `/${encodeURIComponent(name)}` }),
      ),
      Effect.catch(HttpServerRespondable.toResponse),
    );
    return HttpServerResponse.setHeaders(response, {
      ...UNTRUSTED_FILE_HEADERS,
      "Content-Type": attachment.mediaType,
      "Content-Location": pathToFileURL(attachment.file).href,
      ...(PAGE_TYPES.test(attachment.mediaType)
        ? { "Content-Disposition": `attachment; filename*=UTF-8''${encodeURIComponent(name)}` }
        : {}),
    });
  }).pipe(Effect.orDie);

/** The request body as bytes, refused once it passes the attachment limit, as declared or as read. */
export const uploadedBytes = (path: string) =>
  Effect.gen(function* () {
    const request = yield* HttpServerRequest.HttpServerRequest;
    const declared = Number(request.headers["content-length"]);
    if (declared > MAX_ATTACHMENT_BYTES)
      return yield* new AttachmentTooLarge({ path, size: declared });
    const chunks: Array<Uint8Array> = [];
    let size = 0;
    yield* Stream.runForEach(request.stream, (chunk) => {
      size += chunk.length;
      if (size > MAX_ATTACHMENT_BYTES) return Effect.fail(new AttachmentTooLarge({ path, size }));
      chunks.push(chunk);
      return Effect.void;
    }).pipe(Effect.catchTag("HttpServerError", Effect.die));
    const bytes = new Uint8Array(size);
    let offset = 0;
    for (const chunk of chunks) {
      bytes.set(chunk, offset);
      offset += chunk.length;
    }
    return bytes;
  });
