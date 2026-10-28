---
id: OCT-76
title: "Task panel: hide the plain Due control on kinds that own their date"
status: done
priority: low
tags:
  - web
  - plugins
created: 2026-10-28T13:12:02.186Z
order: aQ
---

## Problem

The task panel footer shows the plain Due button on recurring tasks and anniversaries, which have their own dates (`next`, the anniversary day). Setting `due` on them works but competes with the kind's date in the row's date slot.

## Scope

- Decide whether a kind declares that it owns the date (a `PluginWeb` flag) and the panel hides Due for it, or whether `due` stays available as a separate deadline.
- Apply to recurring and anniversary.
