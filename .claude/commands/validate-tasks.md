---
description: Double-check and validate a tasklist for gaps, issues, and improvements. Directly fixes all problems found in the task files.
model: opus
---

# Validate Tasks

## Purpose

You are a **senior technical reviewer** specializing in task quality assurance.
Your job is to validate a task folder written by `/write-tasks`, find gaps,
inconsistencies, and issues, and **fix them directly** in the task files. You run
after task authoring is complete, before execution begins.

**Arguments**: $ARGUMENTS

The argument should be either:

- A **task folder** path (e.g., `tasks/cli-tool/`) — validates all tasks
- A **single task file** path (e.g., `tasks/cli-tool/3-commands.md`) —
  validates just that task (still reads README and sibling tasks for context)

## Step 1: Detect Mode and Load Tasks

### 1a. Determine scope

- If the argument points to a **directory** (or ends with `/`), validate all
  tasks in the folder (**full mode**).
- If the argument points to a **single `.md` file**, validate only that task
  (**single mode**). Still read the parent folder's README and sibling tasks for
  context, but only report/fix issues in the target task.

### 1b. Load files

1. Read the `README.md` in the task folder (or the target file's parent folder).
2. In **full mode**: list and read **all** task files matching `N-*.md` (exclude
   `X-` prefixed).
3. In **single mode**: read the target task file. Also read `X-` prefixed
   siblings for context on what's already done.
4. Read any parent `README.md` if the folder is nested.

## Step 2: Validate Against the Codebase

Launch **parallel Explore subagents** (one per task, max 5 concurrent) to verify
every concrete reference in each task file:

### 2a. File path verification

For every file path mentioned in a task:

- Verify the file exists at that path
- If it doesn't, find the correct path and note the fix
- Check that referenced functions, types, and utilities exist in those files

### 2b. Schema and type verification

For every Zod schema, type, or function referenced:

- Verify it exists with the stated field names and types
- Check that referenced utilities/helpers are actually exported from where the
  task claims
- Verify Commander option names and types match existing patterns

### 2c. Existing code detection

For every new file, function, component, or utility a task proposes to create:

- Search the codebase to check if it already exists (partially or fully).
  Check `src/`, `src/lib/`, `src/commands/`, `src/api/`, `tests/`.
- Search for naming conflicts (same name, different module)
- If a near-equivalent exists: prefer **extending or reusing** the
  existing symbol over creating a parallel version. Fix the task to
  reference the existing import path and note any extension needed.

### 2d. Dependency verification

For each task's stated prerequisites:

- Verify the dependency exists as a task file
- Verify the dependency covers what the dependent task claims it provides
- Check for **unstated dependencies** — does a task implicitly require something
  from another task without declaring it?

## Step 3: Structural Analysis

### 3a. Task sizing

For each task, evaluate against the sizing rules from `/write-tasks`:

- **Too small?** (< 50 lines of real code, < 3 files, exists solely to enable
  the next task) — flag for merging
- **Too large?** (> 15 files, 2+ independent deliverables, mixes unrelated
  domains) — flag for splitting
- **Right size?** (3-10 files, one clear deliverable, 50+ lines of real code)

### 3b. Ordering validation

Walk through tasks 1, 2, 3, ... in sequence and confirm:

- Each task's prerequisites are satisfied by lower-numbered tasks
- Core/lib tasks come before their command consumers
- Shared infrastructure comes before consumers
- No circular dependencies exist

### 3c. Coverage analysis

Check for **gaps** — work that is needed but not covered by any task:

- Missing Zod schema definitions for new command options
- Missing Commander subcommand registration
- Missing output formatting for `--json` flag on new commands
- Missing exit-code handling
- Missing test coverage (vitest) for new lib functions or command output
- Missing config (`conf`) read/write for new settings
- CLI surface changes without README/help-text updates

### 3d. Redundancy detection

Check for **overlap** between tasks:

- Two tasks creating the same file or modifying the same function
- Duplicate work spread across tasks
- Unnecessary intermediate tasks that could be folded into their consumers

### 3e. Reusability and code placement

For every new file, type, function, or utility that genuinely needs to be
created, verify it is placed where every actual consumer can import it — not
buried in one command folder when multiple commands will use it.

- Shared across multiple commands → `src/lib/` or `src/api/`
- Single-command helpers → co-located in `src/commands/<command>/`
- Never duplicate types or utilities across command folders

## Step 4: Content Quality Review

For each task file, check:

### 4a. Requirements quality

- Are requirements specific enough to implement without guessing?
- Do they include exact file paths, function signatures, Zod schema shapes,
  Commander option names?
- Are code snippets accurate (correct field names, types, imports)?

### 4b. Acceptance criteria quality

- Is every requirement reflected in the acceptance criteria?
- Are criteria testable/verifiable (can run `pnpm test`, invoke CLI, etc.)?
- Are any criteria missing for implied work?

### 4c. Files to Create/Modify table

- Does the table include all files the task will actually touch?
- Are any files listed that shouldn't be?
- Are the stated actions (Create/Modify) correct?

### 4d. Consistency

- Do task files use consistent terminology?
- Do field names match the actual codebase?
- Are the same concepts named the same way across all tasks?

## Step 5: Second Wave — Edge Case Sweep

Steps 2-4 catch _what's specified but wrong_. This step catches _what isn't
specified at all but should be_. Walk every task through each category below
and explicitly answer: **"Does this task handle X, and if not, should it?"**

### 5a. Failure and error paths

- What happens if the API call fails or returns an error response?
- Network timeouts, connection refused, rate limits from the Invinite API
- Invalid or expired API key — is the error message helpful?
- Partial response / unexpected JSON shape — does Zod catch it cleanly?

### 5b. Empty, null, and boundary states

- Empty arrays / no rows / zero-count API responses
- Single-item case where display logic implicitly assumes >= 2
- Missing optional fields in API responses
- Pagination: first page, last page, single-page result sets

### 5c. Auth and config

- Missing API key — is the error message actionable?
- Config file missing or corrupted — does it reset gracefully?
- Keychain read errors — does it fall back correctly?
- Does the command validate the API key before making network calls?

### 5d. Exit codes

- Does every command exit with code 0 on success?
- Does every command exit with a non-zero code on error?
- Are exit codes consistent with POSIX conventions?

### 5e. Output formatting

- Does the command support `--json` for machine-readable output?
- Does the default table output handle wide/narrow terminals gracefully?
- Are numbers formatted consistently (e.g., currency, percentages)?
- Does `--all` pagination work correctly (termination, rate limiting)?

### 5f. Config integrity

- New config keys: are they documented and have sensible defaults?
- Config reset: does `config reset` clear new keys too?
- Config show: does `config show` display new keys?

### 5g. Arg/flag validation

- Are all Commander options validated with Zod before use?
- Are required options enforced with clear error messages?
- Are mutually exclusive options handled?
- Are allowed values for enum-like options documented in help text?

### 5h. Test coverage

- New lib functions covered by vitest unit tests?
- New command output covered by snapshot or integration tests?
- Error paths tested (invalid API key, network error, empty response)?

### 5i. Mirror and tooling drift

- New `.claude/commands/`, `skills/`, or `agents/` entry mirrored to
  `.codex/`, `.cursor/`, `.agent/` per the provider mirror rules?
- Deleted entries → mirrors removed in the same change?

### Output of Step 5

Fold edge-case gaps into the Step 6 per-task finding tables using
`Category = "Edge case"` plus a sub-tag (e.g. `Edge case / Exit codes`,
`Edge case / Auth`, `Edge case / Output`). Apply the same severity scale:

- **Critical**: missing handling will produce broken or unsafe code
  (missing auth check, no exit code on error, Zod crash on unexpected API shape)
- **Moderate**: missing handling will produce suboptimal code
  (no `--json` support, missing empty state, unhelpful error message)
- **Minor**: stylistic or low-impact gaps

Critical and Moderate edge-case gaps must be fixed in Step 7.

## Scope Rules for Single vs Full Mode

- **Full mode**: All checks apply to all tasks. Cross-task issues are reported
  and fixed. README is updated for structural changes.
- **Single mode**: Steps 2-5 run only against the target task. Cross-task
  checks (3b ordering, 3d redundancy) still run but only report/fix issues that
  affect the target task.

## Step 6: Report Findings

Output a structured report:

```
## Validation Report: <feature-name>

### Summary
- Tasks validated: N
- Issues found: N (X critical, Y moderate, Z minor)

### Per-Task Findings

#### Task N: <title>

| # | Category | Severity | Finding | Fix |
|---|----------|----------|---------|-----|
| 1 | Stale path | Critical | `src/old/path.ts` doesn't exist | Correct to `src/new/path.ts` |
| 2 | Missing dep | Moderate | Implicitly needs Task 2's helper | Add to Prerequisites |
| 3 | Sizing | Minor | Only touches 2 files, ~30 lines | Consider merging into Task N+1 |

### Cross-Task Issues

| # | Category | Severity | Finding | Fix |
|---|----------|----------|---------|-----|
| 1 | Gap | Critical | No task adds Zod schema for new options | Add to Task 1 |
| 2 | Overlap | Moderate | Tasks 2 and 4 both define the same formatter | Consolidate in Task 2 |
| 3 | Ordering | Critical | Task 3 needs Task 4's helper | Swap order or add dep |

### README Issues

| # | Finding | Fix |
|---|---------|-----|
| 1 | Dependency graph doesn't match task numbers | Update graph |
```

**Severity levels:**

- **Critical**: Will cause task execution to fail or produce incorrect code
- **Moderate**: Won't fail but will produce suboptimal code
- **Minor**: Cosmetic or stylistic

## Step 7: Fix All Issues

After reporting, **directly edit the task files** to fix all Critical and
Moderate issues. For each fix:

1. Edit the task file with the corrected content.
2. If tasks need reordering, rename files to maintain sequential numbering
   (use `git mv` for tracked files).
3. If tasks need merging, combine content into the target task and delete the
   source task (use `git rm` for tracked files). Update numbering.
4. If tasks need splitting, create new task files with correct numbering.
5. Update the `README.md` to reflect any structural changes.

### What to fix directly:

- **Stale file paths** — replace with verified paths
- **Wrong field/type/function names** — replace with actual names from codebase
- **Missing prerequisites** — add to the Prerequisites section
- **Missing acceptance criteria** — add criteria for uncovered requirements
- **Missing files in Files to Create/Modify** — add missing entries
- **Inaccurate code snippets** — correct to match actual codebase
- **Missing coverage** — add requirements for gaps (exit codes, Zod schemas,
  test coverage, `--json` support)
- **Task ordering issues** — renumber and update dependency references
- **Sizing issues** — merge too-small tasks, split too-large ones

### What NOT to fix (flag only):

- Architectural decisions that may need user input
- Ambiguous requirements where multiple valid interpretations exist
- Scope questions (should feature X be included or deferred?)

For these, use `AskUserQuestion` to get clarification before proceeding.

## Step 8: Final Verification

After all fixes:

1. Re-read every modified task file to confirm changes are correct.
2. Verify task numbering is sequential with no gaps.
3. Verify all cross-references between tasks are consistent.
4. Verify the README's dependency graph and summary table match the actual task files.
5. Report a final summary.

## Constraints

- Read every task file completely — do not skim
- Verify all file paths, types, and functions against the actual codebase
- Maximum 5 parallel Explore subagents at any time
- Fix issues directly in files — do not just report them
- Use `git mv` for renames, `git rm` for deletions
- Ask the user only for genuine ambiguities or architectural decisions
- All output in English
- Do not modify `X-` prefixed (completed) task files
- Do not change the feature folder name
- Preserve the established task file format (Goal, Prerequisites, Current
  Behavior, Desired Behavior, Requirements, Files to Create/Modify,
  Acceptance Criteria)
