# 0011. Attachments are read through one operation, and plugin files only through their plugin

- Status: accepted
- Date: 2026-10-28

## Context

[0005](0005-one-operation-catalog.md) made attachment download an HTTP-only endpoint. An agent on
MCP or the CLI can therefore not read an attachment's bytes, such as an image it was asked to look
at, while a person sees that image in the app. [0007](0007-first-party-plugins-per-workspace.md)
lets a plugin own files in a task folder (`log.jsonl` for recurring tasks), which stop counting as
attachments, but did not say whether any client may read them.

Effect 4.0.6's `McpServer` was checked in a stdio prototype:

- A `Toolkit` tool always answers with one text block of its encoded success, plus
  `structuredContent`. A tool whose success holds bytes sends the agent a base64 string, not an
  image.
- `McpServer.addTool` on the `McpServer` service takes a handler that returns a whole
  `CallToolResult`. Its content can be `ImageContent` (`{ type: "image", data, mimeType }`) or an
  `EmbeddedResource` with `BlobResourceContents`.
- Resource templates work (`McpServer.resource` with `McpSchema.param`), but a `/` in the path must
  be percent-encoded, and a `Uint8Array` result loses its media type.

## Decision

### Attachment bytes

- `read_attachment` is a catalog operation that only reads. Its input is the task id and the
  attachment's path in the task folder. It serves only files the engine lists as attachments of
  that task.
- Its success is a file, the catalog's one output that is not a schema. Each generator writes it in
  its own surface's form:
  - HTTP: the download endpoint in [0006](0006-effect-httpapi-replaces-hono.md), with its headers,
    `Range` and `ETag` handling.
  - MCP: a tool registered through `McpServer.addTool`. A PNG, JPEG, GIF or WebP file is an
    `ImageContent` block, so the agent sees the image. A text file (`text/*`, JSON, SVG) is a text
    block. Anything else is an `EmbeddedResource` whose `uri` is the file's `file://` URL. A file
    larger than the upload limit is a typed error.
  - CLI: the bytes go to stdout, or to the file `--output` names.
- The task detail (`get_task`) lists its attachments as `{ path, size, mediaType }`, so an agent
  knows what it can read. One engine lookup sets the media type for every surface.
- octodo has no MCP resources. A resource is application-controlled in MCP, so the host decides
  when it is read, and it would be a second, MCP-only entry point outside the catalog.

### How the engine reads them

- The engine lists a task's attachments in `storage/tree.ts`, the one reader of the folder
  grammar: every file in the task folder and its plain folders, but not `task.md` or `list.md` in
  any case, a folder holding one of them, a hidden name or a symlink. `read_attachment` first
  refuses a path that attachment upload refuses (`InvalidRequest`), then one the listing does not
  have (`AttachmentNotFound`).
- The upload limit (`MAX_ATTACHMENT_BYTES` in `contract/rules.ts`, 20 MB) also bounds a read, on
  every surface (`AttachmentTooLarge`), since the engine reads the bytes into memory. The HTTP
  download streams the file and is not bounded.
- The media type comes from `mediaType` in `engine/src/tasks/media-type.ts`, by extension. The HTTP
  download sends the same type.

### Files a plugin owns

- A file a plugin owns is that plugin's storage, not part of the API. `read_attachment` refuses it
  with the same not-found error as a missing file, and the task detail does not list it. That
  holds in every task whose `type` names the plugin, also while the workspace does not enable it.
- What such a file holds reaches clients only through the plugin's computed fields and its
  read-only operations. The recurring plugin computes the next due date and has an operation that
  lists the occurrences from `log.jsonl`.
- The app and agents use the same fields and operations, so neither one sees more than the other.

## Consequences

- An agent reads an attachment the way a person opens one, through the same operation, and the
  contract test table covers it on every surface.
- The plugin parses its file once, in the engine. The browser never parses `log.jsonl`, and a
  malformed line is a diagnostic, not a value a client has to guess about.
- A plugin can change its file's format behind its schema version without breaking a client.
- The file stays plain on disk. A person can open `log.jsonl` in an editor, outside octodo.
- Attachment upload stays HTTP-only. Whether an agent can attach a file is a separate decision.
