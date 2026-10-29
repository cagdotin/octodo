---
id: OCT-98
title: An "Install octo command" action in the desktop app
status: todo
tags:
  - desktop
  - cli
created: 2026-10-29T17:45:22.642Z
order: a5
---

The app ships `octo` at `octodo.app/Contents/Resources/bin/octo` (decision 0029), but putting it on the PATH is a manual `ln -s` from the README. VS Code offers "Install 'code' command in PATH". Add the same to octodo's settings or command menu: link `~/.local/bin/octo`, and say so when that folder is not on the PATH or an `octo` that points elsewhere (a checkout's `bin/octo`) is already there.
