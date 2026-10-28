# 0023. Plugins contribute their create fields to the new-task dialog, and a kind's date replaces Due

- Status: accepted
- Date: 2026-10-28

## Context

The app created plain tasks only. Recurring tasks (`create_recurring`), days-since counters
(`create_counter`, [0019](0019-days-since-counters-share-the-occurrence-log.md)) and anniversaries
(`create_anniversary`, [0020](0020-anniversaries-store-the-day-clients-compute-the-next.md)) could
be created from the CLI and MCP, so a Chores workspace
([0022](0022-presets-in-the-contract-workspace-and-plugin-settings-are-operations.md)) could not
make its first chore in the app (OCT-77). Each kind needs different fields: a rule, a day, or
nothing.

The task panel's footer also showed the plain Due button on every task. A task of a kind shows its
own date in the row's date slot ([0016](0016-recurring-tasks-complete-in-place.md)), so a `due` set
there is invisible in the row and goes stale: a recurring task's `due` does not move when it is
done, and an anniversary's does not move to next year (OCT-76).

## Decision

### Creating a task of a kind

| Option                                               | For                                                                                     | Against                                                                                                                                                                         |
| ---------------------------------------------------- | --------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **A kind picker in the new-task dialog** (chosen)    | One shape for every kind. Each kind's fields are chips beside the others. Discoverable. | One more click than typing, and the inline composer stays plain.                                                                                                                |
| Quick-add tokens (`every 3 days` in the title)       | Fastest for recurring, and works in the inline composer too.                            | Recurring only: a counter has no token, and an anniversary's would be a date that chrono already reads as `due`. Nothing shows that the token exists until you know to type it. |
| Convert later ("make it repeat" on an existing task) | Fits a person who decides after the fact.                                               | Needs a new operation that writes `type` on an existing task, and what happens to `due` and `log.jsonl`. It is a second feature, not a way to create.                           |

- The new-task dialog's property row starts with a kind chip when the workspace enables a plugin:
  Task, then each enabled kind in `config.json`'s order. A workspace without plugins sees no chip.
- Picking a kind mounts that kind's own chips after it, and its picker opens at once, with focus in
  it: Recurring's rule field, Anniversary's calendar. A counter has no fields: it starts now.
- The submit button names the kind ("Create recurring task") and stays disabled until the kind's
  draft is ready. The recurring field reads the rule as it is typed with the plugin's own
  `parseRule`, shows "First due: Today" for a rule it reads and the grammar's error for one it does
  not, so a typo never reaches the server.
- The dialog calls the kind's create operation through the plugin's own typed client
  ([0017](0017-the-ui-kit-is-a-package-plugins-type-their-own-client.md)). The app's
  `useCreateTaskOfKind` wraps the call in the same mutation as a plain create: the snapshot
  refetches afterwards and an error is a toast.

### `PluginWeb.create`

`PluginWeb<Fields, Draft>` gains `create: KindCreate<Draft>`:

| Member   | What                                                                                                                           |
| -------- | ------------------------------------------------------------------------------------------------------------------------------ |
| `noun`   | One task of the kind, as the picker names it: "Recurring task", "Days-since counter", "Anniversary"                            |
| `Icon`   | The kind's icon, the one its row shows                                                                                         |
| `empty`  | The kind's draft before anything is set: `{ repeat: "" }`, `null`, `{ date: null }`                                            |
| `Fields` | Optional chips that edit the draft, given `draft`, `onChange` and `onCloseAutoFocus` (focus back to the title)                 |
| `ready`  | Whether the draft can be created                                                                                               |
| `create` | `(workspace, task, draft) => Promise<Task>`: calls the plugin's create operation with `task` (the common fields) and the draft |

- `task` is a `NewTask`, `CreateTaskInput` without `due`: title, status, list, priority, tags and
  notes are the same for every kind, as every create operation's input already spreads them.
- `noun` is the web half's own string, not `PluginShared.name`: the shared half imports Effect,
  which the browser does not load, and the picker names one task ("Anniversary"), not the plugin
  ("Anniversaries").
- The chips are `PropertyChip` from `@octodo/ui`, the dialog's chip moved into the kit so a plugin's
  chips look like the dialog's own.
- `creatableKinds(snapshot)` in `components/task-kind.tsx` is the app's one place that reads
  `snapshot.plugins` for creation.

### Due on a kind

- A task of a kind has no plain Due control: not in the task panel's footer, and not in the
  new-task dialog once a kind is picked. The row's date slot is the kind's (0016), so the kind's
  date is the one date a person sees and sets. No flag on `PluginWeb`: every kind has a `Row`.
- A task of a kind that already has a `due` (set over the CLI, MCP or before this change) still shows
  the control, so a person can see and clear it.
- The counter follows the same rule. Its slot shows the days counted, so a `due` on it was already
  invisible in the row.
- `update_task` still accepts `due` on any task, and it keeps its meaning there (0016). This is a
  choice about what the app offers, not a rule of the data.

## Why

- **The picker over tokens.** Every kind gets the same entry point with its own fields, and a kind
  added later needs only its `create`. Tokens fit one kind well and the others badly, and they are
  invisible until learned. They remain worth adding for the inline composer (OCT-81).
- **The kind opens its own field.** A recurring task without a rule or an anniversary without a day
  cannot be created, so the one thing the person must do next is already in focus. Two Enters
  create it: one closes the field, the next creates.
- **Validating in the browser with the plugin's rule.** `rule.ts` is plain functions, so the field
  says what the rule means before the dialog closes. A refusal from the server would close the
  dialog first and lose the draft.
- **Hiding Due rather than keeping it as a deadline.** Two dates on one task, one of them invisible
  in every list, is a trap, and no kind today has a use for a second date.

## Consequences

- Converting an existing plain task into a kind is OCT-79. The disabled "Repeat" row in the due
  picker waits for it.
- Today and Next 7 days still filter on `due`, so a chore due today is not in Today. Since a
  kind's date now replaces Due, that is OCT-80: they list a task of a kind by its kind's day
  ([0025](0025-a-kind-gives-its-due-day-and-list-tasks-filters-by-it.md)).
- The inline composer still creates plain tasks only (OCT-81).
- A new kind's web half must export `create`; the type makes it required.
