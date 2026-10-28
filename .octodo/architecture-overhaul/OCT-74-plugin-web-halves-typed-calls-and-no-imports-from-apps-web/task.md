---
id: OCT-74
title: "Plugin web halves: typed calls and no imports from apps/web"
status: done
priority: medium
tags:
  - architecture
  - plugins
  - web
created: 2026-10-28T12:48:29.968Z
order: aP
blocked_by: [OCT-57]
---

## Problem

OCT-57 built the first plugin web half (`packages/plugins/src/recurring/web.tsx`). Two shortcuts conflict with decision 0004 (packages depend in one direction) and 0005 (one catalog, typed everywhere):

- `web.tsx` imports the app's UI kit through the `@/` alias, so `packages/plugins` depends on `apps/web` source. Tailwind scans `packages/plugins/src` through an `@source` line in the app's `index.css`.
- `setRepeat` calls the plugin's endpoint through an untyped `fetch`, because the typed client (`@octodo/contract/client`) is typed from `Api`, which holds the core catalog only.

## Scope

A first-principles analysis against `docs/` before choosing:

- Where the shared UI kit lives so a plugin's web half can use it without importing the app (a `ui` package, the app passing components in, or plugin web halves living in `apps/web`).
- How a plugin's operations get a typed client: for example the client typed from `makeApi({ ...catalog, ...pluginShared.operations })` per plugin, with type-only imports so the browser still holds no Effect runtime.
- Record the decision; apply it to the recurring plugin and to any plugin built by then (OCT-58, OCT-59).

## Done when

- Lint forbids `packages/plugins` from importing `apps/web`.
- Plugin web halves call their operations through the typed client.
- The built web bundle still holds no Effect runtime.
