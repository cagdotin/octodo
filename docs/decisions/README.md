# Decisions

Each file records one decision: its context, what was decided and what follows from it. Add a new
file when a decision is made, numbered in order. When a decision changes, write a new record that
supersedes the old one and mark the old one's status.

| #                                                      | Decision                                                                 | Status              |
| ------------------------------------------------------ | ------------------------------------------------------------------------ | ------------------- |
| [0001](0001-octodo-is-the-only-writer.md)              | octodo's own clients are the only writers of `.octodo/`                  | accepted            |
| [0002](0002-server-preferred-topology.md)              | Clients prefer a running server and embed the engine when there is none  | accepted            |
| [0003](0003-one-writer-per-workspace.md)               | One writer per workspace, through an owner lock                          | accepted, not built |
| [0004](0004-packages-by-dependency-direction.md)       | Packages split by dependency direction, not by domain                    | accepted            |
| [0005](0005-one-operation-catalog.md)                  | One operation catalog generates the HTTP API, MCP tools and CLI commands | accepted            |
| [0006](0006-effect-httpapi-replaces-hono.md)           | Effect HttpApi replaces Hono                                             | accepted            |
| [0007](0007-first-party-plugins-per-workspace.md)      | Task kinds are first-party plugins, enabled per workspace                | accepted            |
| [0008](0008-statuses-per-workspace-presets-as-data.md) | Statuses belong to the workspace, and presets are data                   | accepted            |
| [0009](0009-recurring-task-is-one-folder.md)           | A recurring task is one folder with a log of occurrences                 | accepted            |
| [0010](0010-no-authentication-for-now.md)              | No authentication while octodo runs on one computer                      | accepted            |
