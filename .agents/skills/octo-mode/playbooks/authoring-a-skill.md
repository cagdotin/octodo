### Authoring or modifying a skill

**You own the skill's voice.**

Skills live in `.agents/skills/<name>/SKILL.md`, so every harness that reads `.agents/skills` (Claude Code through the `.claude/skills` symlink, Codex, opencode, and others) sees the same file. Write them harness-neutral: say what to do, use the generic terms from **Harness terms** in `../SKILL.md`, and reference other skills by relative path (`../<name>/SKILL.md`).

1. Write the skill. Frontmatter has `name` (matching the folder) and a `description` that front-loads when to use it. Add `disable-model-invocation: true` when the skill should run only when asked or when another skill routes to it. Harnesses that don't know the key ignore it.
2. Validate it: frontmatter parses, referenced files exist, and cross-skill links resolve. `pnpm format` formats the markdown.
3. Test it on a real task if the change is structural. Skip if it is subjective.
4. Run **Opening a PR** when the task asks for one.

When in doubt, delete. Keep only prose that changes a decision. Tell it to do the thing and skip the reason. Explain only when the rule is confusing without one. Point at structural sources (types, `AGENTS.md`, config) per **principle-encode-lessons-in-structure**. Delegate to other skills by path. Don't restate them. A workflow you keep hitting that no skill captures → propose a new skill.

**Reply:** summary of the skill, key design decisions, validation notes.
