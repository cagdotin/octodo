---
id: OCT-34
title: Warn before a body save overwrites an external change to the same task
tags:
  - web
created: 2026-10-26T13:57:10.657Z
order: a2
status: backlog
---

If a person keeps typing in a task body while an agent (MCP or CLI) edits the same body, the person's save overwrites the agent's change. This is how the save path in `machines/editor.ts` behaved before OCT-9 as well. Agents and people now share the editors, so detect the conflict (the file changed since the draft started) and show it rather than dropping the change silently. Follow-up from OCT-9.
