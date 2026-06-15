---
name: explain-pr
description: Analyze a PR and explain changes in natural language with potential code and CLI/UX issues. Use when the user wants to invoke /explain-pr.
---

Read `references/command.md` and follow that workflow in Codex.

Adapt the referenced Claude command for Codex:

- Treat the command file as workflow guidance, not as skill metadata.
- Ignore Claude-only frontmatter such as `model` or `tools`.
- Replace Claude-specific slash-command or subagent steps with the closest direct Codex workflow.
