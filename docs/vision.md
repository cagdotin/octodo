# Vision

octodo is personal software for getting things done, shared between you and your agents. It sits
between the old and the new: the storage is as plain as it gets (folders and markdown files), and
on top of that sit things that are only now becoming normal: AI agents working on the same list
as you, a server you reach from your phone over Tailscale, and software that extends itself.

## What we believe

- **Files are the source of truth.** A task is a markdown file, a status is a folder, a list is a
  folder of folders. Anything that can read a file can read your tasks, and nothing is lost if
  octodo disappears.
- **Local and private by default.** Your tasks stay on your machine. The server binds to
  127.0.0.1, every request needs a token, and reaching it from elsewhere (a phone, over Tailscale)
  is something you switch on, not a cloud you sign up for. octodo should feel trustworthy.
- **Humans and agents are equal citizens.** You plan; agents pick up work through MCP, the CLI or
  the files themselves. One brain, many arms.
- **Simple underneath, ambitious on top.** The implementation stays boring (folders, YAML
  frontmatter, atomic renames) so the product can be bold.

## Where the product is going

The first audience is people who use TickTick, Todoist or any.do for their own life and work; Linear
comes later. So the app moves toward a calm, personal planner rather than an issue tracker:

- **A second sidebar for time:** a calendar, a week view and a timeline beside the lists, so tasks
  with dates live where you plan your days.
- **Icons and colour for lists**, chosen by you, and smart lists (Today, Next 7 days, Overdue,
  filters you save).
- **Habits and recurring tasks**, stored as plain files like everything else (see OCT-4).
- **Every surface stays a view over the files:** list, board, calendar, and whatever plugins add.

## Extensible, and self-extending

octodo should be extensible the way [pi](https://pi.dev) is: small at its core, with plugins that
can change almost anything, and agents that write those plugins for you.

- **Plugins are TypeScript modules** kept as files too: per workspace in `.octodo/plugins/`, or for
  everything in `~/.config/octodo/plugins/`. Share them as npm or git packages.
- **What a plugin can add:** views (a calendar, a habit grid, a reading list), commands in the
  palette and the CLI, MCP tools for agents, fields in the task panel, automations (recurring
  tasks, auto-archive, "when a task moves to Done, ..."), importers and exporters, themes.
- **Self-extension:** ask an agent "add a view that shows my tasks as a reading list" and it writes
  the plugin into your workspace, octodo reloads it, and you keep going. If you like it, keep it;
  if not, delete the file.
- **Safe by construction:** plugins run with declared permissions (which workspaces, network or
  not), and a plugin an agent wrote shows up for review before it runs. Trust stays the default.

The plugin API starts as a sketch (OCT-5) and grows by turning built-in features into plugins.

## The feeling

A tool from the near future that respects the past: inky, quiet and precise, technical without
being cold, and clearly yours. See [branding.md](branding.md) for names, taglines and the mascot.
