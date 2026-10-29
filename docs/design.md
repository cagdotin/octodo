# Visual design

octodo looks like ink on paper, not like a Linear clone. The aim sits between TickTick and Linear:
personal, inky, calm. It is built on old, simple ideas (folders, plain markdown), so it should feel
private, local and trustworthy. [branding.md](branding.md) covers the name, the copy and the icon.

## Tokens

| Token            | Dark      | Light     |
| ---------------- | --------- | --------- |
| Sidebar          | `#171716` | `#f3f1ed` |
| Main surface     | `#1c1c1b` | `#fbfaf8` |
| Text             | `#f0ece5` | `#22211f` |
| Accent (`--ink`) | `#8db3da` | `#33618f` |

The tokens are CSS variables in `packages/ui/src/styles.css`, next to the coss ui components
that use them ([0017](decisions/0017-the-ui-kit-is-a-package-plugins-type-their-own-client.md)).

- The one accent is ink blue. It is used only for urgent "!", the active-row bar and focus rings.
  The brand red is kept for urgent and destructive actions. Add no other accent colours.
- Light mode is near-white paper with very light fills. Avoid warm beige, strong selection fills
  and soft shadows: they read as a generic template.

## Type

- Geist and Geist Mono are the only typefaces, in the app, on the landing page and in generated
  images.
- Titles are Geist. Sidebar items, group headers (lowercase, "in progress 2"), ids, dates, counts,
  tags (`#tag`) and list paths (`packing/` with a folder icon) are Geist Mono.

## Layout

- Keep the density and the macOS chrome (traffic-light strip, drag regions).
- Group headers are plain rows with no fill band and no rule. They toggle on the whole row and stack
  with no gaps, like task rows.
- Status marks are monochrome. The active row has an inset ink bar.
- Surfaces that float over the page (menus, popovers, selects, tooltips) are translucent with a
  backdrop blur. Modals sit on a dimmed backdrop and are opaque cards.
- A new list or sublist is named in a dialog; renaming one happens in its sidebar row.
- List icons sit in the same column as the views above them; a sublist steps in 16px, with a
  hairline guide per level, and ends at the same edge as its parent. A list with sublists shows an
  open folder while they show and a stack of folders while they are folded; hovering its icon turns
  it into the fold chevron. The Lists header folds when its title is clicked and has no chevron.
  What is folded is kept per workspace in the browser.
- The landing page (`apps/site/index.html`) is the reference. Its octopus (`apps/site/octopus.js`)
  should look and move like a real octopus, and stay calm and secondary.
- Every icon is generated from `brand/glyph.svg` by `pnpm brand`.
