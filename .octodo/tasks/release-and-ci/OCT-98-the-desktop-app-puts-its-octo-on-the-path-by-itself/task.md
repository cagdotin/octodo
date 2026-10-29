---
id: OCT-98
title: The desktop app puts its octo on the PATH by itself
status: done
tags:
  - desktop
  - cli
created: 2026-10-29T17:45:22.642Z
order: a5
---

Done: an app installed in `/Applications` or `~/Applications` links `~/.local/bin/octo` to `octodo.app/Contents/Resources/bin/octo` on launch (`apps/desktop/src/octo-link.ts`, decision 0029). It creates the folder when missing, and replaces only a missing or broken link. An `octo` that works, such as a checkout's `bin/octo`, is left alone.

Not done: telling the person when `~/.local/bin` is not on their PATH. A GUI app can't see the shell's PATH without asking the login shell.
