# octodo tasks

## What this source contains

This repo tracks its own work in `.octodo/`, one markdown file per task, committed to git. The layout is in `AGENTS.md` and the **octodo** skill.

- The task body: the problem, the plan, decisions, and notes, often written before the code.
- Frontmatter: `id` (such as `OCT-12`), `title`, `priority`, `tags`, `due`, `created`, `updated`.
- The status folder (`s01-todo`, `s03-done`) and the list folder (`l01-agents`) say where the task stands and what area it belongs to.
- The git history of the file: when the task was written, when its plan changed, and when it moved to done. A move between status folders is a rename in git.

## How to search it

Use the **octodo** skill's tools (MCP or `bin/octo`) to read tasks by id. Use git and `rg` for history and full-text search.

```bash
# Tasks that mention a term, in any status or list
rg -l -i '<term>' .octodo

# A task's file wherever it lives now (file names start with the id)
fd '^OCT-12-' .octodo   # or: find .octodo -name 'OCT-12-*'

# The task's full history through status moves and renames
git log --follow -p -- "$(find .octodo -name 'OCT-12-*')"

# Commits that mention the task id
git log --all --oneline --grep 'OCT-12'

# When text first appeared in any task (the plan, a decision)
git log -S '<exact phrase>' --oneline -- .octodo
```

Read the whole task body and its diff history, not just the title. A task's plan often changed after the code started, and the diff shows that.

### Deleted tasks

A task deleted from `.octodo/` is still in git, and a deleted task is often the most useful evidence: work that was dropped, merged into another task, or abandoned. Search history, not just the working tree. Before the rename in `95695ee`, tasks lived in `.tasks/` with `TMD-` ids, so search both folders.

```bash
# Every task file ever deleted, with the commit that deleted it
git log --diff-filter=D --name-only --format='%h %cs %s' -- .octodo .tasks

# Deleted tasks that mentioned a term (the commit that removed the text)
git log --all -S '<term>' --format='%h %cs %s' -- .octodo .tasks

# A task's history by id, even when no file matches it today
git log --all --format='%h %cs %s' -- ':(glob).octodo/**/OCT-12-*' ':(glob).tasks/**/TMD-12-*'

# Read a deleted task as it was just before the commit that deleted it
git show <deleting-commit>^:<path>
```

Say why a task disappeared when the history shows it: the deleting commit's message, a task that took over its content, or the code that made it moot.

## What good evidence looks like here

- A task body that states the problem the target code solves, or the approach it chose and why.
- A plan in the body that changed between commits, showing a decision that was revised.
- A commit that moves the task to done in the same change as the target code.
- Tags or a list that place the work in a larger effort.

## Common pitfalls

- **Ids, not paths.** File names and folders change when a task moves, a list is renumbered, or the title changes. Search by id.
- **The working tree is not the whole record.** No match in `.octodo/` today is not a null result until you have searched the deleted tasks too.
- **Demo data.** Some workspaces in the repo history are example or demo projects. Check the workspace `name` in `.octodo/config.json` at that commit.
- **Stale plans.** A task written before the code may describe a plan that changed. Cross-check against the commits.

## What to return

For each relevant task: the id and title, the quoted motivation or decision from the body with the commit where it appeared, its status and list (or the commit that deleted it), and the commits that link it to the target code.
