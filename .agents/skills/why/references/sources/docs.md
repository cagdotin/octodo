# Docs in the repo

## What this source contains

- `AGENTS.md` (also `CLAUDE.md`): the on-disk model, the layout, the security rules, and the decisions about the stack. Rules written here were usually written because an agent got them wrong.
- `docs/`: product vision and the design direction.
- `README.md`: the public description of the product.
- `.agents/skills/*/SKILL.md`: workflow rules, including the reason a skill exists.

## How to search it

```bash
rg -n -i '<term>' AGENTS.md README.md docs .agents/skills

# When a rule appeared, and the commit that explains it
git log -S '<exact rule text>' --oneline -- AGENTS.md docs
```

## What good evidence looks like here

- A rule in `AGENTS.md` that names the constraint the target code enforces.
- A design-direction passage in `docs/` that matches a visual or product choice.
- The commit that added a rule, with a message or task that says why.

## Common pitfalls

- **Rules outlive their reason.** A rule may stay after the code that needed it changed. Check the commit that added it.
- **Docs describe intent.** The code may differ. Report the divergence instead of picking one.
