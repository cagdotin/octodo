# Outside-writer handling, October 2026

OCT-48 went through every branch in `packages/core` that exists because something other than
octodo writes `.octodo/`: a sync tool (iCloud's `HM-3-paint 2`), a hand edit, a link. Decision
[0001](../decisions/0001-octodo-is-the-only-writer.md) keeps what validates and reports, and
removes what guesses, ranks, merges, retries or re-reads to cope with such a writer. This is the
classification, taken at commit `9dc25e2`.

## Removed

| Where                           | Branch                                                                                 | Why it goes                                                                                                                                   |
| ------------------------------- | -------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------- |
| `scan.ts` `reportDuplicate`     | A second folder with an id read before, named like a sync copy, is a `conflict-copy`   | It reads meaning into a sync tool's folder name. It is a plain `duplicate-id` now.                                                            |
| `scan.ts` `reportDuplicate`     | `sameTree` compares the copy with the original byte for byte to offer `remove-copy`    | Deduplicating two versions is reconciling them.                                                                                               |
| `scan.ts` `waiting`             | Three queues rank folders with one id: named after id and title, other name, sync copy | It guesses which folder is the original. One queue in reading order is left, and the first folder read is the task.                           |
| `scan.ts` `serveTask`           | `task 2.md` holding its task's id is a `conflict-copy` of `task.md`                    | Another file in a task folder is an attachment by the grammar.                                                                                |
| `scan.ts` `readList`            | `list 2.md` in a list is a `conflict-copy` of `list.md`                                | A markdown file in a list is `loose-markdown` by the grammar.                                                                                 |
| `scan.ts` `reportStray`         | The `copyOf` twin of a conflict copy and its "identical to it" text                    | Only existed for the two rows above.                                                                                                          |
| `storage/tree.ts` `linksMarker` | A folder whose `task.md` or `list.md` is a link is read anew on every scan             | It follows a link's target outside the workspace. A link marker is now a `symlink` diagnostic and the folder is not read.                     |
| `storage/tree.ts` `readMarker`  | The marker is read through a link; `exists` decides a dangling link                    | Same: links are never followed. An `lstat` tells a link from a file.                                                                          |
| `storage/tree.ts` `linkedTime`  | A linked `task.md` is dated by its target                                              | Same.                                                                                                                                         |
| `storage/tree.ts` `sameTree`    | Whole-folder byte comparison                                                           | Its one caller was the conflict-copy comparison.                                                                                              |
| `files.ts` `copied`             | `.new-<uuid> 2` and `.x.<uuid> 2.tmp` count as octodo's leftovers                      | Those are a sync tool's copies of octodo's temporary names. Dot names are never read, so a stray one is harmless.                             |
| `fixes.ts` `keep-copy`          | Turns a conflict copy (folder or file) into a new task                                 | A merge fix for a sync tool's copy. `fresh-id` covers a copied folder.                                                                        |
| `fixes.ts` `renumberCopy`       | Drops the ` 2` from a copy's folder name                                               | Cleans up after a sync tool's naming.                                                                                                         |
| `diagnostics.ts`, `domain.ts`   | The `conflict-copy` kind and the `keep-copy` action                                    | No reader produces them any more.                                                                                                             |
| `layout.ts` `conflictCopyOf`    | Parses iCloud's copy names                                                             | No caller is left.                                                                                                                            |
| `workspace.ts` `writeFresh`     | A write that finds a path gone runs again on a fresh read                              | Another octodo process cannot move folders under a holder: the owner lock makes the next holder forget its cache. Only a hand edit hits this. |

## Kept

| Where                                                             | Branch                                                                                         | Why it stays                                                                                                                                                               |
| ----------------------------------------------------------------- | ---------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `scan.ts` `reportDuplicate`                                       | A second folder with an id is `duplicate-id`, offering `fresh-id`, and its subtree is not read | Validation: two tasks cannot share an id.                                                                                                                                  |
| `scan.ts` `reportStray`                                           | A loose markdown file identical to the task its id names offers `remove-copy`                  | It is what an interrupted `wrap-as-task` leaves: the file gets its id first, then the folder is made, then the file is removed. octodo's own crash, not an outside writer. |
| `scan.ts` `reportStray`                                           | `loose-markdown` with `wrap-as-task`, and `note` for a file without frontmatter                | Validation with an existing fix, picked one at a time.                                                                                                                     |
| `scan.ts` `readTask`, `serveTask`                                 | `invalid-frontmatter`, `malformed-id`, `missing-id`, `foreign-id`, `unknown-status`            | Validators.                                                                                                                                                                |
| `scan.ts` `takeIds`, `tree.ts` `Unread.markdown`, `markdownUnder` | Ids in files the scan does not read count as on disk                                           | See below.                                                                                                                                                                 |
| `scan.ts` `readAhead`, `tree.ts` `entry`                          | A path gone between listing and reading is skipped                                             | Reads take no lock, so another octodo process can rename a folder while one runs.                                                                                          |
| `storage/tree.ts` `entry`                                         | A symlink anywhere is a `symlink` diagnostic and is not followed                               | Validation.                                                                                                                                                                |
| `storage/tree.ts` `entry`                                         | `both-markers`, `list-in-task`, `list-too-deep`, `unmarked-folder`, `unreadable`               | Validators of the folder grammar.                                                                                                                                          |
| `storage/bookkeeping.ts`                                          | `removeLeftovers`, `.gitignore` lines                                                          | Clean up after octodo's own crashed writes. `.owner-lock*` also covers the `.owner-lock-journal` SQLite writes during a hold (seen in a probe).                            |
| `files.ts`                                                        | `writeFileAtomic`, `createFolder`                                                              | Crash safety (0001 keeps it).                                                                                                                                              |
| `fixes.ts`                                                        | `fresh-id`, `wrap-as-task`, `remove-copy`, the three link fixes, `add-status`                  | The fixes octodo already offers (0001), each a row of `PROBLEMS`.                                                                                                          |
| `workspace.ts` `giveIds`                                          | Reads the file again before writing its id, and skips it when it has one                       | The read is needed for the patch. The check only stops a write over an id.                                                                                                 |
| `workspace.ts` `renameFolder`, `moveFolder`                       | Keep the old name, or pick a free one, when a name is taken                                    | Folder names are for people; octodo never overwrites a folder.                                                                                                             |
| `workspace.ts` `attachmentTarget`                                 | Refuse hidden names, markers and paths that follow a symlink out of the task folder            | A request boundary, not reconciliation.                                                                                                                                    |
| `workspace.ts`                                                    | The watcher, and `onNewHolder` forgetting the cache                                            | 0001 keeps the watcher so a hand edit is reported. The cache drop is for other octodo processes.                                                                           |

Counts: 16 removed, 15 kept. In `packages`, the source lost 310 lines and gained 130; the tests
lost 205 and gained 55.

One consequence: the id in a linked `task.md` is not read, so it does not count as on disk. A
new task can take that id, and moving the real file into the workspace then gives a
`duplicate-id`. That follows from not following links.

## Ids in files the scan does not read

The scan collects the `id` of every markdown file under `.octodo/`, including files in folders it
does not read (a folder with both markers, a list too deep, a task whose frontmatter does not
parse, the subtree of a duplicate). Two things use that set: `broken-link` reports only ids no file
has, and the next new id is past the highest one.

This is validation, not reconciliation. It writes nothing and picks between nothing. Without it,
octodo itself would make problems: `drop-unknown-links`, a fix-all fix, would delete a link to a
task that is only unreadable until a person fixes its YAML, which loses what they wrote; and a new
task could take the id of the broken file, so fixing the YAML would produce a `duplicate-id` that
octodo caused. So it stays, with `Unread.markdown` and `markdownUnder`.
