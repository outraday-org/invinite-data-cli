---
name: fix-errors
description: Fix ESLint and TypeScript errors/warnings from pasted output or by running pnpm lint && tsc --noEmit. Use when the user wants to invoke /fix-errors.
---

Read `references/command.md` and follow that workflow in Codex.

Adapt the referenced Claude command for Codex:

- Treat the command file as workflow guidance, not as skill metadata.
- Ignore Claude-only frontmatter such as `model` or `tools`.
- Replace Claude-specific slash-command or subagent steps with the closest direct Codex workflow.
