import {
  AttachmentNotFound,
  AttachmentTooLarge,
  type Attachment,
  type AttachmentContent,
  type AttachmentFile,
} from "@octodo/contract";
import { MAX_ATTACHMENT_BYTES } from "@octodo/contract/rules";
import { Effect } from "effect";
import { isAbsolute, join } from "node:path";
import { LIST_FILE, TASK_FILE } from "../layout.ts";
import { invalid, storageError, type State } from "../state.ts";
import { isHidden } from "../storage/bookkeeping.ts";
import { MARKERS } from "../storage/tree.ts";
import { mediaType } from "./media-type.ts";
import { findTask } from "./operations.ts";

/** The task folder and the path segments of a file inside it, refusing anything else. */
const attachmentTarget = ({ storage, scan }: State, taskId: string, relativePath: string) =>
  Effect.gen(function* () {
    const { snapshot, dirs } = yield* scan;
    yield* findTask(snapshot, taskId);
    const dir = dirs.tasks.get(taskId)!;
    const segments = relativePath.split(/[\\/]/).filter((part) => part !== "" && part !== ".");
    if (isAbsolute(relativePath) || segments.length === 0)
      return yield* invalid("Give a path relative to the task folder");
    if (segments.some(isHidden))
      return yield* invalid("Attachment paths cannot leave the task folder or name hidden files");
    // A case-insensitive file system (macOS, Windows) takes `Task.MD` for `task.md`.
    if (segments.some((part) => MARKERS.includes(part.toLowerCase())))
      return yield* invalid(
        `An attachment cannot be named ${TASK_FILE} or ${LIST_FILE}: that would make a subtask or a list`,
      );
    const subtask = yield* Effect.orElseSucceed(
      storage.exists(join(dir, segments[0]!, TASK_FILE)),
      () => false,
    );
    if (subtask) return yield* invalid("That path is inside a subtask");
    if (
      !(yield* storageError("Could not read the task folder")(storage.staysInside(dir, segments)))
    )
      return yield* invalid("Attachment paths cannot follow symlinks out of the task folder");
    return { dir, segments };
  });

const listed = ({ storage }: State, dir: string) =>
  Effect.map(
    storageError("Could not read the task folder")(storage.attachments(dir)),
    (files): Array<Attachment> =>
      files.map((file) => ({ ...file, mediaType: mediaType(file.path) })),
  );

export const listAttachments = (state: State, taskId: string) =>
  state.read(
    Effect.gen(function* () {
      const { snapshot, dirs } = yield* state.scan;
      yield* findTask(snapshot, taskId);
      return yield* listed(state, dirs.tasks.get(taskId)!);
    }),
  );

const findAttachment = (state: State, taskId: string, relativePath: string) =>
  Effect.gen(function* () {
    const { dir, segments } = yield* attachmentTarget(state, taskId, relativePath);
    const path = segments.join("/");
    const attachment = (yield* listed(state, dir)).find((file) => file.path === path);
    if (attachment === undefined) return yield* new AttachmentNotFound({ task: taskId, path });
    return { ...attachment, file: join(dir, ...segments) } satisfies AttachmentFile;
  });

export const getAttachment = (state: State, taskId: string, relativePath: string) =>
  state.read(findAttachment(state, taskId, relativePath));

export const readAttachment = (state: State, taskId: string, relativePath: string) =>
  state.read(
    Effect.gen(function* () {
      const attachment = yield* findAttachment(state, taskId, relativePath);
      if (attachment.size > MAX_ATTACHMENT_BYTES)
        return yield* new AttachmentTooLarge({ path: attachment.path, size: attachment.size });
      const bytes = yield* storageError("Could not read the attachment")(
        state.storage.readBytes(attachment.file),
      );
      return { ...attachment, bytes } satisfies AttachmentContent;
    }),
  );

export const writeAttachment = (
  state: State,
  taskId: string,
  relativePath: string,
  bytes: Uint8Array,
) =>
  state.write((files) =>
    Effect.gen(function* () {
      const { dir, segments } = yield* attachmentTarget(state, taskId, relativePath);
      return yield* Effect.gen(function* () {
        // One level at a time, so a task folder that has gone is not created again.
        let folder = dir;
        for (const segment of segments.slice(0, -1)) {
          folder = join(folder, segment);
          yield* files.ensureFolder(folder);
        }
        const name = yield* files.createFile(folder, segments.at(-1)!, bytes);
        return [...segments.slice(0, -1), name].join("/");
      }).pipe(storageError("Could not save the attachment"));
    }),
  );
