# 0028. Deleting a list moves its tasks out of any list, and renaming a list renames its folder

- Status: accepted
- Date: 2026-10-29

## Context

Lists could be created and moved but not renamed or deleted. A list is a folder, so deleting one
has to decide what happens to the task folders inside it, to its sublists, and to files the scan
could not read as a task or a list (a note, a duplicate copy, a broken `list.md`). Renaming has to
decide whether the folder follows the name, since a list's id is its folder path.

## Decision

- `rename_list` writes `name` into `list.md` and renames the folder to the name's slug, as a task's
  folder follows its title. The id changes with the slug; a slug another list at that level has is
  refused, as `create_list` refuses it.
- `delete_list` removes the list with its sublists. Their top-level tasks, whatever their status,
  move to the root list (No list) with their subtasks, appended after the tasks there in list
  order. `delete_tasks: true` deletes them instead and removes their ids from other tasks' links,
  as `delete_task` does. Tasks do not move one level up into a parent list: a person deleting a
  list is done with that grouping, and No list is the one place they look for strays.
- A delete is refused while a diagnostic sits in the list's folders outside its tasks' folders.
  Removing the folder would lose a file nobody saw in the app; the person fixes or moves it first.
- The app asks before deleting, in a dialog that counts the tasks and sublists and offers an
  unchecked "Also delete" box.

## Consequences

- A crash part way through an unlisting delete leaves some tasks moved out and the list in place;
  running it again moves the rest and removes the folder.
- A renamed or deleted list changes or drops a list id the app shows in its URL; the app follows
  the change.
