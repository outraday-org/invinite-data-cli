---
name: analyze-earnings-call
description: Earnings call analysis (results vs guidance, guidance changes, analyst focus, tone) using the Invinite API. Use when the user wants to invoke /analyze-earnings-call.
---

Read `references/command.md` and follow that workflow in Codex.

Adapt the referenced Claude command for Codex:

- Treat the command file as workflow guidance, not as skill metadata.
- Ignore Claude-only frontmatter such as `model` or `tools`.
- Replace Claude-specific slash-command or subagent steps with the closest direct Codex workflow.
