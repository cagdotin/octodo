import { slugify } from "@octodo/contract/rules";

/** Files in a task's folder, as the body editor uses them. */
export interface Attachments {
  /** The URL an image in the body loads from, or null to leave it as markdown source. */
  readonly url: (src: string) => string | null;
  /** Saves an image under `images/` and resolves to its path relative to the task folder. */
  readonly upload: (file: File) => Promise<string>;
}

const SCHEME = /^[a-z][a-z0-9+.-]*:/i;

const decoded = (segment: string) => {
  try {
    return decodeURIComponent(segment);
  } catch {
    return segment;
  }
};

/**
 * Images load only from the task folder, through the server. Anything that could resolve elsewhere
 * (`/`, `..`, `%2e%2e`, a web or other URL) stays source.
 */
export const attachmentUrl = (base: string, src: string): string | null => {
  if (src === "" || SCHEME.test(src) || /^[/\\]/.test(src)) return null;
  const segments = src.replace(/^\.\//, "").split(/[/\\]/);
  if (segments.some((segment) => segment === "" || decoded(segment).startsWith("."))) return null;
  return `${base}/${segments.join("/")}`;
};

const EXTENSIONS: Readonly<Record<string, string>> = {
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/gif": "gif",
  "image/webp": "webp",
  "image/avif": "avif",
  "image/svg+xml": "svg",
};

/** A file name that needs no escaping in a markdown link: `Screen Shot 1.PNG` → `screen-shot-1.png`. */
export const attachmentName = (file: Pick<File, "name" | "type">): string => {
  const dot = file.name.lastIndexOf(".");
  const stem = slugify(dot > 0 ? file.name.slice(0, dot) : file.name) || "image";
  const extension =
    (dot > 0 ? slugify(file.name.slice(dot + 1)) : "") || EXTENSIONS[file.type] || "png";
  return `${stem}.${extension}`;
};

/** The markdown that shows an attachment saved at `path` in the body. */
export const imageMarkdown = (path: string) => `![](${/[\s()<>]/.test(path) ? `<${path}>` : path})`;

export const taskAttachments = (workspace: string, task: string): Attachments => {
  const base = `/api/workspaces/${encodeURIComponent(workspace)}/tasks/${encodeURIComponent(task)}/files`;
  return {
    url: (src) => attachmentUrl(base, src),
    upload: async (file) => {
      const res = await fetch(`${base}/images/${encodeURIComponent(attachmentName(file))}`, {
        method: "PUT",
        body: file,
        credentials: "include",
        headers: { "content-type": file.type || "application/octet-stream" },
      });
      const body: unknown = await res.json().catch(() => null);
      if (res.ok && typeof body === "object" && body !== null && "path" in body) {
        if (typeof body.path === "string") return body.path;
      }
      const message =
        typeof body === "object" &&
        body !== null &&
        "error" in body &&
        typeof body.error === "string"
          ? body.error
          : `Upload failed (${res.status})`;
      throw new Error(message);
    },
  };
};
