---
id: OCT-100
title: octo workspace list should show each workspace's description
status: done
priority: low
tags:
  - cli
created: 2026-10-29T19:24:06.550Z
order: a1
---

`octo workspace list` prints only name, key and folder. Each workspace's `config.json` already has a `description`, and agents rely on it to pick the right workspace (it works like a skill description: what the workspace is for and when to use it).

Show the description in `octo workspace list`, for example on an indented line under each workspace or in a `--json` output that includes it, so an agent can choose a workspace from one command without reading config files.

Filed by Grok Bot for cagin.
