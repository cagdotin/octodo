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
- **Humans and agents are equal citizens.** You plan; agents pick up work through MCP or the CLI.
  One brain, many arms. octodo's own clients are the only way to change the files; anything else
  that edits them is outside the contract and shows up as a problem to fix
  ([0001](decisions/0001-octodo-is-the-only-writer.md)).
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

octodo keeps simple primitives at its core and adds everything else on top. A workspace turns on
only what it needs: a coding project gets a Linear-style tracker, a home workspace gets chores that
repeat and a counter of days since the last cigarette.

- **Plugins are first-party.** We write them, in `@octodo/plugins`: recurring tasks, days-since
  counters and anniversaries first, a habit tracker later. Each workspace enables them in its
  `config.json` ([0007](decisions/0007-first-party-plugins-per-workspace.md)).
- **The built-in task goes through the same API.** If the core cannot use the plugin API for its
  own task, the API is not ready.
- **A plugin adds** frontmatter keys, files in a task folder, computed fields, operations (which
  appear in the app, the CLI and MCP at once) and validators that report broken files.
- **Presets are data:** Checklist, Project and Chores set a workspace's statuses and plugins when it
  is created ([0008](decisions/0008-statuses-per-workspace-presets-as-data.md)).

Later, when there is a reason: automations that run a command when something happens, and plugins
written by agents or other people. Both are recorded in the Open ideas list with how to build them.

## The feeling

A tool from the near future that respects the past: inky, quiet and precise, technical without
being cold, and clearly yours. See [branding.md](branding.md) for names, taglines and the mascot.
