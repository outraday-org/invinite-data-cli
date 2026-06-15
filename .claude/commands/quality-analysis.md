---
description: Analyze code quality, reusability, and type patterns. Staff engineer review for diffs, branches, or task verification. Fixes all issues found and runs tsc.
model: opus
---

# Quality Analysis

You are a **senior staff engineer** conducting a thorough code quality review.
Your job is to analyze code against the unified quality rules below — scoped to
the detected mode.

**Arguments**: $ARGUMENTS

## Step 1: Detect Mode

Determine the analysis mode using this priority chain. Stop at the first match.

| Priority | Condition | Mode | Scope |
| -------- | --------- | ---- | ----- |
| 1 | User mentions tasks in arguments (e.g. "tasks/my-feature/ all tasks") | **Task** | Task requirements + all code introduced by the task |
| 2 | Current branch has an open PR | **PR** | Full PR diff + local diff if present |
| 3 | Not on default branch, no open PR | **Branch** | `git diff <default>...HEAD` + local diff if present |
| 4 | Local staged/unstaged changes exist | **Local** | `git diff` + `git diff --cached` |
| 5 | None of the above | — | Tell the user there are no changes to analyze and **stop** |

### Detection commands

```bash
git symbolic-ref refs/remotes/origin/HEAD 2>/dev/null | sed 's@^refs/remotes/origin/@@' || echo main
git branch --show-current
gh pr view --json number,title,baseRefName,url 2>/dev/null
git status --porcelain
```

If mode is **Task**, skip to the Task-specific instructions in Step 2.

## Step 2: Gather Context

### Diff modes (PR, Branch, Local)

| Mode | Diff commands |
| ---- | ------------- |
| **PR** | `gh pr diff` + `git diff` / `git diff --cached` if local changes exist |
| **Branch** | `git diff <default>...HEAD` + local diff if present |
| **Local** | `git diff` + `git diff --cached` |

For each file in the diff, read the **full file** for surrounding context.

### Task mode

1. **Locate task files** — parse the folder path and task specifier from arguments.
2. **Parse requirements** — extract every discrete requirement, acceptance criterion, and specification.
3. **Audit implementation** — use `Explore` subagents (one per task, max 5 concurrent) to search the codebase for the corresponding implementation.
4. **Read all implemented code** — for each file introduced or modified by the task, read the full file for context.

## Review Style

- Be direct and specific. Point to exact lines and explain why they're problematic.
- Make your own judgement calls. Only ask the developer a question when there is a genuine ambiguity you cannot resolve from the code alone.
- After a mediocre fix, challenge: **"Knowing everything you know now, scrap this and implement the elegant solution."**

## Step 3: Check Against Quality Rules

### Diff modes — Parallel Review

For diff modes (PR, Branch, Local), launch **4 parallel review agents** (Sonnet model) using the Task tool.

| Agent | Rules | Focus |
| ----- | ----- | ----- |
| A | 1, 6 | **Conventions & Types** — Zod/Commander patterns + project conventions |
| B | 2, 3 | **Reusability & Placement** — deduplication search + code sharing rules |
| C | 7, 8 | **Correctness, Robustness & Edge Cases** — bugs, security, performance, error handling |
| D | 4, 5 | **Code Health** — new SATD, complexity heuristics, nested ternaries, dense one-liners |

Each agent must:

- Only flag violations **in or directly caused by the diff**
- Score each issue 0-100 using the confidence rubric below
- Include the rule number, `file:line`, and a specific fix suggestion

#### Confidence rubric

- **0**: False positive or pre-existing issue
- **25**: Might be real, might be false positive. Stylistic issues not backed by a project rule
- **50**: Real issue but a nitpick or unlikely to matter in practice
- **75**: Verified real issue that will be hit in practice, or directly cited in a project rule
- **100**: Confirmed definite issue with clear evidence

#### Consolidation

After all 4 agents return:

1. **Filter out issues with confidence < 80**
2. Deduplicate — keep the highest-confidence version for the same line
3. Assign impact levels (HIGH/MEDIUM/LOW)
4. If no issues survive filtering, report a clean bill of health

### Task mode

Check **all code introduced by the task** against all 8 rules below directly.

---

### Rule 1 — Type Patterns

#### Pattern A: Zod Schemas

```typescript
// GOOD — extracted and reused
export const CompanySearchOptionsSchema = z.object({
    query: z.string(),
    limit: z.number().int().positive().default(10),
    offset: z.number().int().nonneg().default(0),
});
export type CompanySearchOptions = z.infer<typeof CompanySearchOptionsSchema>;
```

- `Schema` suffix on all Zod schema objects
- Derive types with `z.infer<typeof XxxSchema>` — never write types manually
- Place in `src/lib/` or alongside the command that uses them
- Reuse across commands when the same shape appears in multiple places

#### Pattern B: Commander Option Typing

```typescript
// GOOD — options typed via Zod parse
const opts = CompanySearchOptionsSchema.parse(options);
```

#### Anti-Patterns

| Anti-pattern | Fix |
| --- | --- |
| Inline `z.object({...})` in command handler | Extract to a named schema |
| Manually written types instead of `z.infer` | Derive from schema |
| Missing Zod validation for Commander options | Add `.parse(options)` |
| `any` types in option handlers | Use `unknown` + type guards |

---

### Rule 2 — Reusability & Deduplication

- **Duplicated logic**: Does the code introduce a function/utility that already exists elsewhere? Search before flagging.
- **Existing utilities ignored**: Check if the code reimplements something in `src/lib/` or `src/api/`. Flag with a pointer to the existing code.
- **Dead code**: Does the code add exports that are never imported?
- **Inconsistent patterns**: Does the code solve a problem differently from how it's solved elsewhere?

#### Search-Before-Creating Checklist

| Looking for… | Search first |
| --- | --- |
| CLI helpers | `src/lib/`, `src/api/` |
| Output formatting | `src/lib/formatters/` or nearest `formatters/` |
| Config access | `src/lib/config.ts` or nearest config helper |
| API client | `src/api/client.ts` or nearest client file |
| Types/schemas | `src/lib/` for shared, co-located for command-specific |

---

### Rule 3 — Code Sharing & Placement

- Shared across multiple commands → `src/lib/` or `src/api/`
- Single-command helpers → co-located in `src/commands/<command>/`
- Never duplicate types, schemas, or utilities across command folders
- If the same Zod schema appears in two command files, extract it to `src/lib/`

---

### Rule 4 — SATD Detection

Flag any **new** `TODO`, `FIXME`, or `HACK` comments introduced in the code. Pre-existing ones are out of scope.

---

### Rule 5 — Complexity Heuristics

- **Large functions**: Any new or modified function exceeding ~50 lines — suggest extraction
- **Deep nesting**: 4+ levels of nesting (if/for/try) — suggest flattening with early returns or extraction
- **Cyclomatic complexity**: Functions with many branches (>10 paths) — suggest decomposition
- **Nested ternaries**: Ternary expressions nested 2+ levels deep — suggest replacing with `if`/`else`
- **Dense one-liners**: Chained operations that sacrifice readability — suggest breaking into named intermediate steps

---

### Rule 6 — Project Conventions

Flag violations of these project conventions:

- No `any` types — use `unknown` with type guards
- No `as` coercion when the source type is already known — `as const` is always allowed; narrowing from `any` or `unknown` is allowed
- No `++`/`--` operators — use `+= 1`/`-= 1`
- No empty arrow functions `() => {}` — use `() => undefined`
- Zod schemas should have `Schema` suffix; derived types should use `z.infer<typeof XxxSchema>`
- Commander options must be validated with Zod before use in handlers
- Exit code 0 on success, non-zero on error — never exit 0 after logging an error
- `--json` flag support for data-output commands (consistent with existing commands)
- No secrets or API keys printed to stdout (even in debug/verbose mode)
- Config values read via the project's `conf`/config helpers, not direct `process.env` reads (except for `INVINITE_DATA_API_KEY` fallback which is by design)
- Error messages must be user-actionable — no raw stack traces or "undefined" in user output

---

### Rule 7 — Correctness & Robustness

- **Correctness**: Does the code do what it claims? Are there edge cases?
- **Security**: Any API keys leaked to stdout? Raw secrets in error messages?
- **Performance**: Unnecessary repeated API calls, missing `--all` pagination handling?
- **Error handling**: What happens when the API returns an error or times out?
- **Test coverage**: Are critical paths tested with vitest?
- **Inline guidance**: Do changes contradict nearby `// IMPORTANT:`, `// NOTE:`, `// WARNING:` comments?

---

### Rule 8 — Edge Case Coverage

Walk the diff through each category. Only flag when missing handling is in scope for the change.

#### 8a — Failure and error paths

- API call fails — does the command exit with a non-zero code and a helpful message?
- Network timeout / connection refused — is it caught and surfaced?
- Non-200 HTTP status — is the error body parsed and displayed?
- Invalid JSON in API response — does Zod catch it and give a clear error?

#### 8b — Empty, null, and boundary states

- Empty result arrays from the API — is the output helpful ("No results found")?
- `null`/`undefined` optional fields in API responses — are they handled?
- Pagination: does `--all` terminate correctly on the last page?
- Off-by-one on `--limit` and `--offset`

#### 8c — Auth and config

- Missing API key — is the error message actionable ("Set your API key with `invinite config set-key`")?
- Invalid API key — does the API's 401 surface a helpful message?
- Config file missing or corrupted — does the command reset gracefully?
- Keychain read errors — does it fall back to config/env correctly?

#### 8d — Exit codes

- Success → exit 0
- Any error (network, auth, validation, unexpected) → exit non-zero
- Consistent with POSIX conventions and existing commands in the repo

#### 8e — Output formatting

- Does the command support `--json` for machine-readable output?
- Does the default table output handle very wide or very narrow data gracefully?
- Are numbers formatted consistently (locale-aware vs raw)?
- Does `--all` handle rate-limited APIs with appropriate backoff?

#### 8f — Config integrity

- New config keys: do they have sensible defaults?
- `config reset` clears new keys?
- `config show` displays new keys?

#### 8g — Arg/flag validation

- All Commander options validated with Zod before use
- Required options enforced with clear error messages
- Mutually exclusive options handled
- Enum-like options documented in help text

#### 8h — Test coverage

- New lib functions covered by vitest unit tests?
- New command output covered by snapshot or integration tests?
- Error paths tested (missing key, network error, empty response)?

#### Severity for edge-case gaps

- **HIGH**: Missing handling will produce broken or unsafe behavior (exit 0 on error, API key leak, crash on empty response)
- **MEDIUM**: Missing handling will produce suboptimal behavior (no `--json`, unhelpful error message, missing empty state)
- **LOW**: Stylistic or low-impact gaps (inconsistent number formatting)

---

## Step 4: Report

### Diff modes (PR, Branch, Local)

For each violation found, output:

```
**[impact]** `file:line` — category
Description of what's wrong.
→ Fix: specific instruction on how to fix it.
```

Group findings by file. If there are no violations, say so.

#### Impact Guidelines

- **HIGH**: Type safety holes (`any`), duplicated code, security issues, correctness bugs, missing edge-case handling that produces broken behavior
- **MEDIUM**: Missing Zod schema extraction, new SATD, inconsistent patterns, missing error handling
- **LOW**: Naming convention mismatches, complexity warnings, stylistic gaps

### Task mode

Output a table per task showing requirement status (Done / Partial / Missing / Issue / Improvement). After all task tables, output an Overall Summary.

## Step 5: Grading

- **Ship**: Code is clean, correct, handles edge cases, follows conventions.
- **Needs work**: Generally solid but has specific issues that must be addressed.
- **Rethink approach**: Fundamental problems with the approach.

## Step 6: Fix Issues

After reporting and grading, **fix all HIGH, MEDIUM and LOW issues** found. For each issue, edit the code directly.

**Exception:** If a later task in the same task folder will explicitly address the issue, skip the fix and note it as deferred.

## Step 7: Type Check

After fixing issues, run TypeScript on all changed files:

```bash
tsc --noEmit
```

Fix all type errors. Re-run until zero errors remain.

**Do not run ESLint** — it is too slow.

## Step 8: Rename Completed Task Files

**Task mode only.** After grading, if a task's verdict is **Complete** and its task file does **not** already have the `X-` prefix, rename it:

```bash
git mv tasks/.../N-task-name.md tasks/.../X-N-task-name.md
```

## Constraints

- Only report on code in scope for the detected mode
- Read changed/implemented files for context but do not scan unrelated directories
- Fix all HIGH, MEDIUM and LOW issues found — do not just report them
- Maximum of 5 parallel subagents at any time (task mode)
- Be specific — cite file paths and line numbers where possible
- All output must be in English

### False positive avoidance

Do not flag:

- Pre-existing issues in unchanged code
- Intentional functionality changes directly related to the task/PR purpose
- Issues explicitly silenced in code (e.g., eslint-disable, @ts-ignore with explanation)
- Pedantic nitpicks a senior engineer wouldn't call out in review
- General code quality opinions not backed by a specific rule above
