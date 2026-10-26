import { assign, fromPromise, not, setup } from "xstate";

export interface Draft {
  title: string;
  body: string;
}

type EditorEvent =
  | { type: "EDIT"; field: keyof Draft; value: string }
  /** The task changed elsewhere (another tab, an agent, vim); adopt it unless we have unsaved edits. */
  | { type: "EXTERNAL"; draft: Draft }
  | { type: "FLUSH" }
  | { type: "RETRY" };

export interface EditorContext {
  draft: Draft;
  /** What the server has as far as we know; `draft` differing from it means unsaved edits. */
  saved: Draft;
  error: string | null;
}

const isDirty = ({ draft, saved }: EditorContext) =>
  draft.title !== saved.title || draft.body !== saved.body;

/** Only sends fields that changed, and never an empty title (the API rejects it). */
export const changes = ({ draft, saved }: EditorContext): Partial<Draft> => {
  const patch: Partial<Draft> = {};
  if (draft.title !== saved.title && draft.title.trim() !== "") patch.title = draft.title.trim();
  if (draft.body !== saved.body) patch.body = draft.body;
  return patch;
};

/**
 * Title/body editor for one task: viewing → editing (debounced) → saving → saved, with error
 * and retry. The `save` actor is provided by the component so it can go through TanStack Query.
 */
export const editorMachine = setup({
  types: {
    context: {} as EditorContext,
    events: {} as EditorEvent,
    input: {} as Draft,
  },
  actors: {
    save: fromPromise<Draft, { patch: Partial<Draft>; draft: Draft }>(() => {
      throw new Error("save actor not provided");
    }),
  },
  guards: {
    dirty: ({ context }) => isDirty(context),
    savable: ({ context }) => Object.keys(changes(context)).length > 0,
  },
  actions: {
    edit: assign({
      draft: ({ context, event }) =>
        event.type === "EDIT" ? { ...context.draft, [event.field]: event.value } : context.draft,
    }),
    adopt: assign(({ context, event }) => {
      if (event.type !== "EXTERNAL" || isDirty(context)) return {};
      // The server trims titles and normalises trailing newlines; don't yank the text under the cursor for that.
      const same =
        event.draft.title.trim() === context.saved.title.trim() &&
        event.draft.body.trimEnd() === context.saved.body.trimEnd();
      return same ? {} : { draft: event.draft, saved: event.draft };
    }),
  },
}).createMachine({
  id: "editor",
  context: ({ input }) => ({ draft: input, saved: input, error: null }),
  initial: "viewing",
  on: {
    EDIT: { target: ".editing", actions: "edit" },
    EXTERNAL: { actions: "adopt" },
  },
  states: {
    viewing: {},
    editing: {
      after: { 700: "saving" },
      on: {
        // Typing restarts the debounce timer.
        EDIT: { target: "editing", reenter: true, actions: "edit" },
        FLUSH: "saving",
      },
    },
    saving: {
      always: { guard: not("savable"), target: "viewing" },
      invoke: {
        src: "save",
        input: ({ context }) => ({ patch: changes(context), draft: context.draft }),
        onDone: {
          target: "saved",
          // Mark exactly what was sent as saved; edits made meanwhile stay dirty.
          actions: assign({ saved: ({ event }) => event.output, error: null }),
        },
        onError: {
          target: "error",
          actions: assign({
            error: ({ event }) =>
              event.error instanceof Error ? event.error.message : "Save failed",
          }),
        },
      },
      on: {
        // Keep typing while a save is in flight; we pick it up once it finishes.
        EDIT: { actions: "edit" },
      },
    },
    saved: {
      always: { guard: "dirty", target: "editing" },
      after: { 1_500: "viewing" },
    },
    error: {
      on: {
        RETRY: "saving",
        FLUSH: "saving",
      },
    },
  },
});
