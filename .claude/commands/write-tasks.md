---
description: Write a new task folder with individual task files and a README inside tasks/.
model: opus
---

# Write Tasks

## Purpose

You are a task planning specialist focused on breaking down features into
well-structured implementation tasks. Your job is to create a new folder inside
`tasks/` with individual task files and a README that describes the execution
order and dependency graph.

## Task

1. Understand the feature requirements from the user's description
2. Explore the codebase to understand existing patterns, architecture, and
   relevant files
3. Interview the user using `AskUserQuestion` to clarify requirements,
   architectural decisions, and edge cases
4. Create the task folder structure:
    - A `README.md` with overview, architecture decisions, dependency graph,
      and task summary table
    - Individual task files numbered sequentially (e.g. `1-schema-and-types.md`,
      `2-commands.md`) — **never** use an `X-` prefix, as that marks
      completed tasks
5. Write all files to `tasks/<feature-name>/`

## Critical: Task Sizing

**Default bias: keep each task spec small enough for one focused
session.** The size budget is measured **in lines of the task spec
file itself** — the markdown you are about to write, not the code it
produces. Target **~200-300 lines per task spec file**; 300 lines is
still fine, ~400+ is the split signal. If your draft spec would
meaningfully exceed ~300 lines, split it into sequentially-numbered
subtasks — even if every subtask lives in the same layer.

File count of touched code is **not** the primary signal — a 20-file
task with a tight 250-line spec is fine, while an 8-file task whose
spec sprawls to 500 lines is too large and must be split.

The natural starting shape is still layer-aligned:

1. **Core / lib layer** — `src/lib/`, `src/api/`, Zod schemas, shared
   types, API client wrappers, utilities. Co-located unit tests for any
   new helpers/algorithms go in the task that implements them.
2. **Command layer** — `src/commands/`: Commander command definitions,
   option parsing, output formatting (chalk/ora), config handling (conf).
3. **Tests** — vitest tests for commands and lib functions, integration
   tests, CLI snapshot tests.

But these layers are starting points, not hard limits. If the
core/lib foundation is genuinely large, split it into multiple
sequential tasks.

**Co-locate tests with the code they test.** Unit tests for new
lib helpers and pure functions are written in the same task as the
implementation, not in a separate test task.

**Spec length IS a reason to split.** A 600-line task spec is not
one task — it is two or three.

If you are torn between splitting and merging, **split**.

### When to split

Split whenever any of these are true:

- **The task spec would meaningfully exceed ~300 lines** — break it into
  sequential subtasks along natural seams (lib → commands → tests).
- **The feature has 2+ independent CLI commands** — split along command
  boundaries.
- **A pure algorithm is complex enough to warrant its own focused
  session** (parser, data transformer) — pull it out with its unit tests.
- **A large refactor must land before consumer wiring**, and there are
  2+ consumers — refactor first, then wire consumers.

Do not split for:

- One task enabling the next with < 50 lines of bridging code (fold
  it into the consumer).
- "Tests" as a standalone task (co-locate with the code, or use the
  one dedicated test task).
- Symbolic separations with no LOC weight.

### Merge and split heuristics

| Scenario | Action |
| --- | --- |
| Draft lib spec under ~300 lines (types + utils + API client all fit) | **Merge** into one lib task |
| Draft lib spec would exceed ~300 lines | **Split** into sequential subtasks |
| Draft command spec under ~300 lines | **Merge** into one command task |
| Draft command spec would exceed ~300 lines | **Split** (option parsing → formatting → wiring) |
| Lib + command that calls it | **Split** — lib first, then command |
| Pure algorithm with non-trivial spec | **Split** into its own task with unit tests |
| Two unrelated commands shipped together | **Split** along command boundaries |

## Critical: Numbering = Execution Order

**Task numbers define the execution order.** Task 1 runs before Task 2, which
runs before Task 3. There is no separate "recommended sequential order" — the
file numbering IS the order.

When deciding on order:

- Core/lib layer before command layer (data/utilities must exist before commands use them)
- Shared infrastructure before consumers
- Independent pure functions can go early (before their consumers)

**Do not** create dependency graphs that require non-sequential execution.

## Critical: Reuse and Edge Cases

### Reuse before creating

Before specifying a new file, function, or utility, search for an existing
equivalent in `src/`, `src/lib/`, `src/commands/`, `src/api/`. If one exists,
the task **reuses or extends** it — never write a parallel version.

When new code is justified, plan its placement so future consumers can import
it:

- Shared across multiple commands → `src/lib/` or `src/api/`
- Single-command helpers → co-located in `src/commands/<command>/`

Plan shared placement only when >=2 real consumers exist — do not invent
abstractions for a single consumer.

### Plan for edge cases up front

Every task's Requirements and Acceptance Criteria must explicitly cover,
where applicable:

- **Failure paths** — errors, network timeouts, non-200 responses, missing
  API key, invalid args
- **Empty / boundary states** — empty result sets, zero-item pagination,
  missing optional fields
- **Exit codes** — non-zero on error, zero on success; consistent across
  all commands
- **Output formatting** — `--json` flag support for new commands, chalk/ora
  loading spinners, table alignment
- **Config integrity** — `conf` read/write, missing config keys, keychain
  errors
- **Arg/flag validation** — Zod schema for all command options, helpful
  error messages on invalid input
- **Test coverage** — vitest tests for new lib functions and command output
  formatting

Bake these into the task body, not a separate checklist.

## File Structure

```
tasks/<feature-name>/
  README.md
  1-<task-slug>.md
  2-<task-slug>.md
  3-<task-slug>.md
  ...
```

## README.md Structure

Follow the established pattern from existing task READMEs. Include these sections
in order:

### 1. Title & Overview

Feature name as H1, then a concise description of what's being built and why.

### 2. Current State

What exists today. Relevant files, commands, helpers, patterns.

### 3. Target State

What should exist after all tasks are complete. Include file structure, command
architecture, data flow — the full picture. Individual tasks reference back to this.

### 4. Architecture Decisions

A table of key decisions with rationale:

```markdown
| Decision          | Rationale                |
| ----------------- | ------------------------ |
| **Decision name** | Why this choice was made |
```

### 5. Dependency Graph

ASCII art showing which tasks depend on which:

```
Task 1 (lib / types)
  |
  v
Task 2 (commands)
  |
  v
Task 3 (tests)
```

### 6. Task Summary Table

```markdown
| #   | Title                | Type     | Dependencies | Est. Complexity |
| --- | -------------------- | -------- | ------------ | --------------- |
| 1   | [Title](./1-slug.md) | Lib      | None         | High            |
| 2   | [Title](./2-slug.md) | Commands | 1            | Medium          |
```

### 7. Code Reuse

Table of existing code to reuse — prevents task implementers from duplicating.

### 8. Deferred / Follow-Up Work

Bullet list of related work not covered by these tasks.

## Individual Task File Structure

Each task file follows this pattern:

```markdown
# Task Title

> **Status: TODO**

## Goal

One paragraph describing the single deliverable of this task.

## Prerequisites

What must be completed before this task can start. Reference task numbers.

## Current Behavior

What exists today (if modifying existing functionality).

## Desired Behavior

What should exist after this task is complete.

## Requirements

Numbered sections with specific implementation details, code snippets,
file paths, and Zod schema definitions where applicable. This is the bulk of
the task — be thorough and specific.

## Files to Create / Modify

Table of files that will be touched:
| File | Action | Purpose |
|------|--------|---------|

## Acceptance Criteria

Bulleted checklist of what "done" means for this task.
```

## Execution Strategy

- **Research First**: Before writing any tasks, thoroughly explore the codebase
  to understand existing patterns, reusable components, and potential conflicts
- **Use Subagents for Discovery**: Launch `Explore` subagents to find relevant
  files, existing implementations, and architectural patterns
- **Interview the User**: Use `AskUserQuestion` to clarify ambiguous
  requirements, architectural trade-offs, and prioritization
- **Size your tasks by spec line count**: Estimate the line count of
  the task spec file you would write — not the code it produces. 300
  lines is still fine; ~400+ is the split signal.
- **Verify ordering**: After drafting, walk through the tasks in order and
  confirm each task's prerequisites are satisfied by lower-numbered tasks.
- **Be Specific**: Include exact file paths, code snippets, Zod schema shapes,
  Commander option names, and function signatures.

## Constraints

- Task files use **numeric prefixes only** (e.g. `1-`, `2-`, `3-`) — never `X-`
  (that prefix marks completed tasks)
- **Numbering = execution order** — no exceptions
- Folder name should be kebab-case matching the feature name
- All task content must be written in English
- Include concrete code snippets and file paths — tasks should be self-contained
  enough for a subagent to implement without extensive codebase exploration
- Reference existing patterns and components to reuse — never propose duplicating
  existing functionality
- Include Zod schema shapes for any new command options
- Consider test coverage (vitest) for new lib functions and command output

## Self-Check Before Writing

Before writing task files, verify:

1. **No task spec meaningfully exceeds ~300 lines** (300 is still
   fine, ~400+ is the split signal).
2. **Tests are co-located** with the code they test.
3. **No task exists solely to enable the next task** with < 50 lines of
   bridging code — fold it into the consumer.
4. **Task numbers match execution order** — walk through 1, 2, 3... and
   confirm each task's prerequisites are satisfied by lower-numbered tasks.
5. **No "parallel execution waves" section** — the numbered order is
   sufficient.
6. **Reuse verified** — every new symbol checked against existing code.
7. **Edge cases addressed** — failure paths, exit codes, arg validation,
   output formatting, config integrity, and test coverage are covered.
