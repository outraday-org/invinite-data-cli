---
description: Execute all tasks in a task folder (or a single task file) — plan, implement, and quality-analyze each task using agent teams.
model: opus
---

# Execute Tasklist

## Purpose

You are a task orchestrator (team lead) that processes an entire task folder
end-to-end. For each task, you spawn **teammates** that plan, implement, and
quality-fix the code. Teammates are full Claude Code sessions that can spawn
their own subagents and run commands/skills.

**Arguments**: $ARGUMENTS

The argument can be:

- A **task folder** (e.g., `tasks/cli-tool/`) — executes all tasks in the folder
- A **single task file** (e.g., `tasks/cli-tool/3-some-task.md`) — executes only that task

## Step −1: Detect Runtime

Inspect the tools available to you in _this_ session, then pick **exactly one**
orchestration branch and ignore the others for the rest of the turn:

- **Claude Code branch** — choose if you have a `TeamCreate` tool and an
  `Agent` tool that accepts `team_name`, `mode`, and `model` parameters.
  Follow `## Runtime A: Claude Code orchestration` below.
- **pi branch** — choose if you have a single `teams` tool with actions
  `member_spawn`, `delegate`, `task_list`, and `member_stop`. Follow
  `## Runtime B: pi orchestration` below.
- **Codex branch** — choose if you have neither of the above team surfaces
  but can spawn **subagents**. Follow `## Runtime C: Codex orchestration`
  below.

If none of these tool surfaces is present, stop and tell the user the runtime
is unsupported.

Steps 0, 1, 7, and 8 are runtime-agnostic and apply to all branches.

## Step 0: Environment Setup

Before doing anything else, ensure the development environment is ready.

### 0a. Install dependencies

Check whether `node_modules/` exists in the project root. If it does not, run:

```bash
pnpm install
```

Wait for it to complete before proceeding.

## Step 1: Discover Tasks

**Detect mode** based on the argument:

- If the argument ends in `.md` → **single-task mode** (the argument is a task file)
- Otherwise → **folder mode** (the argument is a task folder)

### Folder mode

1. Read the `README.md` in the provided task folder to understand the feature.
2. List all task files matching the pattern `N-*.md` (where N is a number).
   Exclude files prefixed with `X-` (already completed).
3. Sort by number to get execution order.
4. Report the task list to the user:

```
Found <N> tasks to execute in <folder>:
  1. <task-1-filename> — <task title from first line>
  2. <task-2-filename> — <task title>
  ...
```

If no uncompleted tasks are found, tell the user and stop.

### Single-task mode

1. Derive the task folder from the file's parent directory.
2. Read the `README.md` in that folder for context.
3. Verify the file exists and is not already prefixed with `X-`.
4. The task list is just the one file. Report:

```
Executing single task: <task-filename> — <task title from first line>
```

---

## Runtime A: Claude Code orchestration

Follow this section only if Step −1 selected **Claude Code**.

## Step 2: Create Team

Create a team for executing the tasklist:

```
TeamCreate: execute-<folder-name>
```

You are the team lead. Teammates will be spawned for each phase.

## Step 3: Parse Dependencies

Read the **Task Summary** table from the README.md and extract the
**Dependencies** column for each task. Build a dependency map and group tasks
into **execution waves**.

Report the execution plan to the user:

```
Execution plan (parsed from README.md dependencies):
  Wave 1 (parallel): Task 1, Task 6
  Wave 2 (parallel): Task 2, Task 4, Task 5, Task 7
  Wave 3 (parallel): Task 3
```

If the Dependencies column is missing or all tasks list "None", fall back to
**sequential execution** (each task is its own wave).

## Step 4: Execute Waves

Process waves **sequentially**. Within each wave, execute all tasks **in
parallel** using teammates.

### For each wave:

Spawn **one teammate per task** in the wave, all in a **single message** with
multiple Agent tool calls so they run concurrently. Each teammate is named
`plan-execute-<N>` using the Agent tool with `team_name`,
`mode: "bypassPermissions"`, and **always `model: "opus"`**.

**Model rule (non-negotiable):** Every plan+execute teammate runs on
`model: "opus"` — never Sonnet, never Haiku, regardless of task size.

```
Plan and implement task: <full-path-to-task-file>

You are a senior engineer. Follow these steps:

1. Read the task file and the parent folder's README.md for context.
2. Read any sibling tasks prefixed with X- (already completed) for context.
3. Validate every reference in the task against the codebase:
   - Verify files, types, functions exist at stated paths
   - Check if work is already partially done
   - Search for naming conflicts before creating anything new
4. Check for issues: duplicate code, missing reuse, convention violations,
   missing steps the task doesn't mention.
5. Write a validated .plan.md file next to the task file (audit artifact).
   Use this structure:
   - Context, Pre-existing work, Issues found, Improvements
   - Numbered steps with verified file paths and concrete details
   - Files to create/modify table
   - Acceptance criteria checklist
6. Implement all steps from the plan:
   - Follow the plan precisely
   - Search before creating any new file/type/function
   - Follow all project conventions (README.md, eslint config)
   - Use existing patterns from neighboring files
7. Update any documentation for every folder you touched.

Rules:
- Reuse first — extend existing code instead of creating new
- Minimal diff — smallest change that achieves the goal
- **Concurrent edits are expected** — other agents (and your sibling
  teammates) may be editing this repo at the same time. Do not be confused
  by modified/untracked files you did not create, unexpected diffs, or a
  working tree that changes under you. Only touch files your own task owns;
  never revert, stash, or `git checkout`/`git restore`/`git clean` files
  outside your task (you would destroy another agent's in-flight work).
- All file paths must be verified against actual codebase, not copied from task
- Write .plan.md even though you implement it yourself — it's an audit artifact
- **Clarify before guessing** — if the task is ambiguous, call `AskUserQuestion`
  to resolve every open question before finalizing `.plan.md` or writing code.
- **Do NOT run `pnpm lint`, `tsc --noEmit`, or any other typecheck/lint
  commands.** The user runs these themselves after the tasklist is complete.
  Just write correct code and move on.
```

**Wait for ALL teammates in the wave to complete.** Then verify each generated
`.plan.md` exists.

#### Progress reporting

After all tasks in a wave complete, report:

```
Wave <W>/<total-waves> complete:
  Task <N>/<total>: <task-title> — Plan+Execute: completed
  Task <M>/<total>: <task-title> — Plan+Execute: completed
```

**Then proceed to the next wave.**

## Step 5: Quality Pass

After all waves are complete, spawn a final teammate named
`quality-holistic` using the Agent tool with `team_name`,
`mode: "bypassPermissions"`, and `model: "opus"`:

### Folder mode (multiple tasks)

```
Quality review for all tasks in: <full-path-to-task-folder>

Run /quality-analysis with argument: "<full-path-to-task-folder> all tasks"

This will:
1. Parse all requirements and acceptance criteria from EVERY task file
2. Audit each task's implementation against its requirements
3. Check all code introduced by every task against all quality rules
   (reusability, code sharing, SATD, complexity, conventions, correctness)
4. Catch cross-task issues: duplicate code, inconsistent patterns,
   unused imports, dead code, integration issues
5. Grade each task individually AND provide an overall grade
6. Fix all HIGH, MEDIUM and LOW issues found
7. Rename task files with X- prefix for tasks graded Complete + Ship
```

### Single-task mode

```
Quality review for task: <full-path-to-task-file>

Run /quality-analysis with argument: "<full-path-to-task-folder> task <N>"

This will:
1. Parse all requirements and acceptance criteria from the task file
2. Audit the implementation against each requirement
3. Check all code introduced by the task against all quality rules
4. Report findings with impact levels
5. Grade the implementation
6. Fix all HIGH, MEDIUM and LOW issues
7. Rename task file with X- prefix if Complete + Ship
```

## Step 6: Clean Up Team

After all tasks are processed, clean up:

```
TeamDelete: execute-<folder-name>
```

---

## Runtime B: pi orchestration

Follow this section only if Step −1 selected **pi**. Everything below mirrors
Steps 2–6 of Runtime A, translated to pi's `teams` tool surface. Worker output
is read from `task.result` in the JSON returned by `teams action: "task_list"`.

### Step 2 (pi): Implicit team

pi auto-derives the team ID from the leader's cwd; there is no `TeamCreate`
equivalent. Skip directly to Step 3.

### Step 3 (pi): Parse Dependencies

Identical to Runtime A Step 3.

### Step 4 (pi): Execute Waves

Dispatch all tasks in one wave via a single `teams delegate` call. Use
`model: "anthropic/claude-opus-4-7"` and `thinking: "high"` for every worker.

Record the `taskIds` returned by `delegate`. Poll `teams action: "task_list"`
until every matching task has `status === "completed"` or `status === "failed"`.

### Step 5 (pi): Quality Pass

Run the quality pass via `teams delegate` with a single spawn and a single task
(same prompt as Runtime A Step 5, folder mode vs single-task mode).

### Step 6 (pi): Stop Workers

```
action: "member_stop"
all: true
```

---

## Runtime C: Codex orchestration

Follow this section only if Step −1 selected **Codex**. Three Codex-specific
constraints override Runtime A instructions:

1. **No autoload of skills or slash commands.** Subagents must Read workflow
   files from `.codex/skills/<name>/references/command.md` and follow them
   directly.
2. **Depth is capped at 1.** A spawned subagent cannot spawn its own subagents.
3. **Model inherits from the parent session.** Omit any per-agent model override.

### Step 4 (Codex): Execute Waves

Spawn one subagent per task concurrently in a single message. Prepend this
preamble to each spawn prompt:

```
You are a Codex subagent. You do NOT have the leader's slash commands or
skills autoloaded, and you cannot spawn your own subagents (depth is capped).
Do all of the following work yourself. If any step references a slash command
or skill, instead Read the matching file under
`.codex/skills/<name>/references/command.md` (or its `SKILL.md`) and follow
that workflow directly.
```

Then append the same nine-step plan+execute prompt as Runtime A Step 4.

### Step 5 (Codex): Quality Pass

Spawn a single quality subagent with this preamble:

```
You are a Codex subagent performing a holistic quality review. You cannot
spawn your own subagents and do NOT have the /quality-analysis skill
autoloaded. Read `.codex/skills/quality-analysis/references/command.md`
and perform every step of that workflow YOURSELF — do not attempt to delegate;
instead audit each quality dimension sequentially.
```

Then append the folder-mode or single-task-mode quality body from Runtime A
Step 5.

### Step 6 (Codex): No cleanup

Codex subagents are ephemeral. Proceed to Step 7.

---

## Step 7: Clean Up Plan Files

Delete all `.plan.md` files generated during execution:

```bash
rm <task-folder>/*.plan.md
```

## Step 8: Final Report

```
## Execution Complete: <feature-name>

### Execution Plan
  Wave 1 (parallel): Task 1, Task 6
  Wave 2 (parallel): Task 2, Task 4
  Wave 3: Task 3, Task 5

### Results

| Task | Wave | Plan+Execute | Quality Grade | Status |
|------|------|-------------|---------------|--------|
| 1: <title> | 1 | OK | Ship | Marked done |
...

**Overall quality grade:** <grade> — <N> issues fixed

### Action Items
- [ ] <Any tasks that need rework>
- [ ] <Any unresolved issues>
```

## Constraints

- Process waves **sequentially** — a wave only starts after the previous wave completes
- Within each wave, execute all tasks **in parallel** using concurrent teammates
- Do NOT implement code yourself — always delegate to teammates
- Do NOT analyze code yourself — always delegate to teammates
- **Other agents may be editing the repo concurrently** while this run is in
  progress. Treat unexpected modified/untracked files and a shifting working
  tree as normal — do not be confused by them, and never revert or clean
  files outside the current task's scope
- Skip tasks that already have an `X-` prefix
- All reporting must be in English
- Teammates run with `bypassPermissions` mode for autonomous execution (Runtime A only)

## Error Handling

- **Plan+Execute teammate fails**: Report the error, continue to next task
- **Quality pass teammate fails**: Report the error, include partial results
- **All tasks skipped**: Report why and suggest fixes
