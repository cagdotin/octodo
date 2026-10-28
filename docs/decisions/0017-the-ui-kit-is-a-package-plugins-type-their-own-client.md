# 0017. The UI kit is the `@octodo/ui` package, and a plugin's web half types its client from its own operations

- Status: accepted
- Date: 2026-10-28

## Context

The first plugin web half (OCT-57, [0016](0016-recurring-tasks-complete-in-place.md)) took two
shortcuts:

- It imported the app's UI kit through the `@/` alias, so `packages/plugins` depended on
  `apps/web` source, against the one-way direction of
  [0004](0004-packages-by-dependency-direction.md).
- It called its operation through an untyped `fetch`, because the typed client
  ([0006](0006-effect-httpapi-replaces-hono.md)) was typed from `Api`, the core catalog only,
  against [0005](0005-one-operation-catalog.md)'s one catalog typed everywhere.

The days-since counter (OCT-58) and the anniversary (OCT-59) will each build a row and a panel on
whatever this settles: date labels, a button, a popover, maybe a calendar, and one or two of their
own operations.

## Decision

### Where the UI kit lives

| Option                                 | Dependency direction                                                                                                                                                                                             | Reader load                                                                                                                      | What OCT-58/59 get                                                                                 |
| -------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------- |
| **A `packages/ui` package** (chosen)   | `ui` ← `plugins` (web halves) ← `apps/web`, one way. `ui` imports no octodo package.                                                                                                                             | One more package, at the place shadcn's own monorepo layout puts it; an import says where the component is.                      | Every component, `cn` and the date labels by import, with the plugin's three halves in one folder. |
| The app hands components to the plugin | No import, but the kit's types must come from the app or from a second declaration of shadcn's props.                                                                                                            | Every plugin component takes a kit through props or context; a reader follows the kit back to the app to see what a `Button` is. | Each component a plugin wants is first an app change.                                              |
| Web halves live in `apps/web`          | Fine on paper (the app imports a plugin's shared types), but a plugin is split across two packages, and its web half can reach the app's internals (the query cache, routes), which couples more with each kind. | Smallest diff today. A plugin is no longer one folder ([0014](0014-one-plugin-api-for-the-plain-task-and-every-plugin.md)).      | The app's optimistic mutation helpers, at the price of the split.                                  |

`@octodo/ui` holds what the shadcn CLI manages and what a plugin's web half needs to look like the
app:

- `src/components/` the shadcn components, `src/hooks/use-mobile.ts`, `src/lib/utils.ts` (`cn`).
- `src/lib/dates.ts`: `dueInfo` (a day as rows show it: "Today", "Oct 3", overdue or not),
  `dueDay` and `formatTimestamp`. Every planned kind shows a date in the row's date slot.
- `src/styles.css`: the design tokens, the dark variant, the base layer and the fonts. It
  `@source`s its own folder, so Tailwind generates the kit's classes in any app that imports it.
  The app's `index.css` imports it after Tailwind and `@source`s `packages/plugins/src`, since
  the app decides which plugins it bundles.
- The kit has no app state. Sonner's `Toaster` takes `theme` as a prop; the app passes its own.
- Components import each other by package name (`@octodo/ui/components/button`), which is what
  the shadcn CLI writes from `packages/ui/components.json`. `apps/web/components.json` points the
  `ui`, `utils` and `hooks` aliases at the package, so `shadcn add` run in `apps/web` writes there.

### Typed calls

- `createClient<A = typeof Api>(base)` in `@octodo/contract/client` is typed from any API
  definition; without a type argument it is the catalog's, as before. `RouteKey`, `JsonRouteKey`,
  `Input`, `Success`, `ErrorBody` and `Client` take the same optional argument.
- `ServedApi<Ops>` in `@octodo/contract/api` is the API that serves a set of operations, which
  `makeApi` builds. A web half types its client from its own shared half's operations:
  `createClient<ServedApi<typeof recurringShared.operations>>("")`, with both imported as types.
  An empty base calls the page's own origin, as the app's client does.
- A wrong route, a wrong payload or a wrong reading of the success fails the typecheck. The
  browser still holds no Effect runtime: the client's only runtime code is its own `fetch`
  wrapper.

### Lint

- No file in `packages/plugins/src` imports `@/…`, a path into `apps/web` or `@octodo/web`.
- `packages/ui/src` imports no octodo package but itself, no app, no Node module and no Effect.
- A plugin's web half keeps the browser rules of the app: no engine, no plugin engine half, no
  Effect runtime, the contract and the API definition as types only.
- `apps/web/src/scrolling.test.ts` checks the kit and the plugins as well as the app.

## Consequences

- A plugin's web half calls the client and gets the new snapshot from the change feed, not from
  the app's optimistic mutations (`apps/web/src/lib/api.ts`). A kind that needs an optimistic
  update adds it to `PluginWeb` then.
- The error type of a plugin operation lacks `PluginNotEnabled` (409), which the registry adds at
  runtime. A web half reads `ApiError.message` and shows it.
- Building a web half (OCT-58, OCT-59): `<plugin>/web.tsx` imports components from
  `@octodo/ui/components/*`, dates from `@octodo/ui/lib/dates`, makes one client from its shared
  half's operations, exports a `PluginWeb` and is added to `webPlugins` in `packages/plugins/src/web.ts`.
  A component the kit lacks is added with `shadcn add` from `apps/web`.
