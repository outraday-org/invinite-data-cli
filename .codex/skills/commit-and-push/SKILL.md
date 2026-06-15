---
name: commit-and-push
description: Stage all changes, commit with a brief fitting message, and push to remote. Use when the user wants to invoke /commit-and-push.
---

Read `references/command.md` and follow that workflow in Codex.

Adapt the referenced Claude command for Codex:

- Treat the command file as workflow guidance, not as skill metadata.
- Ignore Claude-only frontmatter such as `model` or `tools`.
- Replace Claude-specific slash-command or subagent steps with the closest direct Codex workflow.
