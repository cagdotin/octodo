# Domain records

Two kinds of record keep architecture reviews from going in circles. Create each one lazily, only when there is something to write. Neither exists yet.

## Glossary: `docs/glossary.md`

The canonical names for octodo's domain concepts. `AGENTS.md` already defines the on-disk model, so the glossary holds only terms that a review or design session sharpened beyond it.

```markdown
# Glossary

## Language

**Task**:
One markdown file with YAML frontmatter, identified by the `id` in its frontmatter.
_Avoid_: item, todo, card
```

- Be opinionated. When several words exist for one concept, pick one and list the rest under _Avoid_.
- One or two sentences per term. Say what it is, not what it does.
- Only octodo concepts. General programming terms don't belong, however often the code uses them.
- No implementation details. It is a glossary, not a spec or a scratch pad.
- When a user's term conflicts with the glossary, say so at once: "The glossary defines a list as X, but you seem to mean Y. Which is it?"

## Decisions: `docs/adr/`

One short file per decision, numbered in sequence: `0001-slug.md`, `0002-slug.md`. Find the highest number and add one.

```markdown
# <Short title of the decision>

<One to three sentences: the context, what we decided, and why.>
```

Add a `Status` line (proposed, accepted, superseded by 0007), considered options or consequences only when they add something.

Offer a record only when all three hold:

1. **Hard to reverse.** Changing your mind later costs something real.
2. **Surprising without context.** A future reader would wonder why it was done this way.
3. **A real trade-off.** There were genuine alternatives, and one was picked for specific reasons.

Good examples: the architectural shape, integration between packages, technology with lock-in, scope decisions (the explicit no's count), deliberate departures from the obvious path, constraints the code doesn't show, and rejected alternatives whose rejection isn't obvious. Small decisions that already fit in `AGENTS.md` (such as "Effect holds all logic") can stay there.
