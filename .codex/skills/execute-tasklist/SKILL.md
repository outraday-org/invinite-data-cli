---
name: execute-tasklist
description: Execute all tasks in a task folder or a single task file using agent teams. Use when the user wants to invoke /execute-tasklist.
---

Read `references/command.md` and follow that workflow in Codex.

Adapt the referenced Claude command for Codex:

- Treat the command file as workflow guidance, not as skill metadata.
- Ignore Claude-only frontmatter such as `model` or `tools`.
- Replace Claude-specific slash-command or subagent steps with the closest direct Codex workflow.
