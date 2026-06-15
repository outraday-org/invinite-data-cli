---
description: Fix ESLint and TypeScript errors/warnings — from pasted output or by running pnpm lint && tsc --noEmit.
---

# Fix Errors

## Purpose

You are a code-quality fixer. Your task is to resolve **all** ESLint errors, ESLint warnings, and TypeScript errors in the codebase. Source the initial error list either from the user's pasted input or by running `pnpm lint && tsc --noEmit` yourself, then iterate until the project is clean.

## Task

### Phase 1: Source the error list

1. Inspect the user's prompt for pasted ESLint or TypeScript output. Indicators:
    - Lines like `path/to/file.ts:12:5  error  ...  rule-name` (ESLint)
    - Lines like `path/to/file.ts(12,5): error TS2345: ...` (tsc)
    - `✖ N problems (X errors, Y warnings)` summaries
2. **If errors are pasted:** parse them into a deduplicated list of `{ filePath, line, column, message, source }` entries. Skip Phase 1.3.
3. **If nothing is pasted:** run `pnpm lint && tsc --noEmit` once to collect all ESLint and TypeScript issues. Note every file path that has at least one error or warning.

### Phase 2: Fix

1. Group issues by file. For each affected file:
    - Read the file.
    - Apply the minimal correct fix for every reported error and warning. Follow the repo's conventions (README.md, eslint config): no `any`, no `as` coercions, consistent naming, Zod schema reuse, Commander option typing, etc.
    - Do not introduce unrelated refactors.
2. After each batch of edits, re-verify only the files you touched:
    - ESLint: `npx eslint --cache --cache-location node_modules/.cache/eslint/ --fix <file1> <file2> ...`
    - TypeScript: `tsc --noEmit` (tsc cannot type-check a subset reliably; if the per-file invocation produces noise, fall back to the full `tsc --noEmit` only when ready to verify).
3. If a fix is non-obvious (rule disagreement, type model conflict, missing import path), read related files via Grep / Read before editing — never guess.

### Phase 3: Verify

1. Run `pnpm lint && tsc --noEmit` to re-collect ESLint **and** TypeScript output across the whole project.
2. If any errors or warnings remain, return to Phase 2 with the new list.
3. Repeat Phases 2–3 until both commands exit cleanly with zero errors and zero warnings.

### Phase 4: Report

1. Summarize in 1–3 sentences: how many files were touched, how many ESLint errors / warnings / TS errors were resolved, and the final status.
2. Do **not** commit or push — that is the user's call.

## Constraints

- Never disable lint rules (`// eslint-disable-...`) or suppress TS errors (`// @ts-ignore`, `// @ts-expect-error`) to make a check pass. If a rule is genuinely wrong for a case, ask the user before suppressing.
- Never widen types to `any` or use `as` casts to silence TypeScript. Use `unknown` + narrowing, proper generics, or fix the underlying type.
- Never delete code purely to make errors disappear — fix the actual issue.
- Do not run `pnpm lint` / `tsc --noEmit` repeatedly on the full project during Phase 2; only the final Phase 3 verification re-runs the full check.
- Stop and ask the user if the same error persists after two distinct fix attempts — there may be a deeper architectural issue.
