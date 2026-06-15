---
name: fix-bug
description: Paste an error, get a fix. Autonomous bug resolution. Use when the user wants to invoke /fix-bug.
---

Read `references/command.md` and follow that workflow in Codex.

Adapt the referenced Claude command for Codex:

- Treat the command file as workflow guidance, not as skill metadata.
- Ignore Claude-only frontmatter such as `model` or `tools`.
- Replace Claude-specific slash-command or subagent steps with the closest direct Codex workflow.
