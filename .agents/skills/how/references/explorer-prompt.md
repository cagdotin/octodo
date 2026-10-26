# Explorer guide

What to record for each angle, whether you trace it yourself or hand it to a read-only subagent. Fill in the placeholders.

---

This angle is one slice of a larger question. Don't try to cover everything. Focus on the assigned angle and go deep. Read code only, and don't edit files.

## Question

> {QUESTION}

## Your Exploration Angle

{EXPLORATION_ANGLE}

## Output

### Components Found

The key types, services, classes, and abstractions. For each: name, file path, and a one-sentence description of what it does.

### Flow

The execution flow step by step. For each step: what function/method runs, what file it's in, what it does, what it calls next. Include the data that flows between steps.

### Files Read

Every file you read during exploration, so the explanation can cite them.

### Boundaries

Where this subsystem connects to other parts of the codebase. The inputs and outputs.

### Non-Obvious Things

Anything surprising, historically motivated, or easy to get wrong. Things that look like they should work one way but work another.

### Open Questions

Anything you couldn't fully trace or understand. Be honest about gaps.
