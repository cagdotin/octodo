# Decisions

Each file records one decision: its context, what was decided and what follows from it. Add a new
file when a decision is made, numbered in order. When a decision changes, write a new record that
supersedes the old one and mark the old one's status.

| #                                                                                    | Decision                                                                                                 | Status                    |
| ------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------- | ------------------------- |
| [0001](0001-octodo-is-the-only-writer.md)                                            | octodo's own clients are the only writers of `.octodo/`                                                  | accepted                  |
| [0002](0002-server-preferred-topology.md)                                            | Clients prefer a running server and embed the engine when there is none                                  | accepted                  |
| [0003](0003-one-writer-per-workspace.md)                                             | One writer per workspace, through an owner lock                                                          | accepted                  |
| [0004](0004-packages-by-dependency-direction.md)                                     | Packages split by dependency direction, not by domain                                                    | accepted                  |
| [0005](0005-one-operation-catalog.md)                                                | One operation catalog generates the HTTP API, MCP tools and CLI commands                                 | accepted                  |
| [0006](0006-effect-httpapi-replaces-hono.md)                                         | Effect HttpApi replaces Hono                                                                             | accepted                  |
| [0007](0007-first-party-plugins-per-workspace.md)                                    | Task kinds are first-party plugins, enabled per workspace                                                | accepted                  |
| [0008](0008-statuses-per-workspace-presets-as-data.md)                               | Statuses belong to the workspace, and presets are data                                                   | accepted                  |
| [0009](0009-recurring-task-is-one-folder.md)                                         | A recurring task is one folder with a log of occurrences                                                 | accepted                  |
| [0010](0010-no-authentication-for-now.md)                                            | No authentication while octodo runs on one computer                                                      | accepted                  |
| [0011](0011-attachments-are-one-operation-plugin-files-are-private.md)               | Attachments are read through one operation, and plugin files only through their plugin                   | accepted                  |
| [0012](0012-only-storage-touches-the-disk.md)                                        | Only storage touches the disk, and writes go through `Files`                                             | accepted                  |
| [0013](0013-every-surface-gives-the-operations-result.md)                            | Every surface gives an operation's own result                                                            | accepted                  |
| [0014](0014-one-plugin-api-for-the-plain-task-and-every-plugin.md)                   | One plugin API for the plain task and every plugin                                                       | accepted                  |
| [0015](0015-http-endpoints-outside-the-catalog.md)                                   | HTTP endpoints outside the catalog                                                                       | accepted                  |
| [0016](0016-recurring-tasks-complete-in-place.md)                                    | Recurring tasks complete in place, through a hook on the move                                            | accepted                  |
| [0017](0017-the-ui-kit-is-a-package-plugins-type-their-own-client.md)                | The UI kit is the `@octodo/ui` package, and a plugin's web half types its client from its own operations | accepted                  |
| [0018](0018-connect-finds-the-server-through-server-json.md)                         | The CLI and stdio MCP find the server through server.json, and embed the engine only when none answers   | accepted                  |
| [0019](0019-days-since-counters-share-the-occurrence-log.md)                         | Days-since counters share the occurrence log, and completing one closes it                               | accepted, amended by 0027 |
| [0020](0020-anniversaries-store-the-day-clients-compute-the-next.md)                 | Anniversaries store the day, clients compute the next one, and lists keep their order                    | accepted, amended by 0027 |
| [0021](0021-the-desktop-app-attaches-to-or-spawns-the-server.md)                     | The desktop app attaches to the server, or spawns and supervises one                                     | accepted                  |
| [0022](0022-presets-in-the-contract-workspace-and-plugin-settings-are-operations.md) | Presets live in the contract, and adding a workspace and choosing its plugins are operations             | accepted                  |
| [0023](0023-plugins-contribute-their-create-fields-and-own-the-date-slot.md)         | Plugins contribute their create fields to the new-task dialog, and a kind's date replaces Due            | accepted                  |
| [0024](0024-the-desktop-app-is-packaged-with-electron-builder.md)                    | The desktop app is packaged with electron-builder, and its server child runs from app.asar               | accepted                  |
| [0025](0025-a-kind-gives-its-due-day-and-list-tasks-filters-by-it.md)                | A kind gives its due day, and Today, Next 7 days and `list_tasks` filter by it                           | accepted, amended by 0027 |
| [0026](0026-a-server-claims-its-home-with-a-lock.md)                                 | A server claims its home with a lock, so one runs per home                                               | accepted                  |
| [0027](0027-plugins-add-sections-tasks-is-the-built-in-one.md)                       | Plugins add sections; tasks is the built-in one                                                          | accepted                  |
