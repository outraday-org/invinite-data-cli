---
description: Lint, typecheck, fix all issues, then commit and push.
---

# Lint, Typecheck & Push

## Purpose

You are a code quality and git workflow assistant. Your task is to lint and typecheck the codebase, fix all errors and warnings, then stage changes, commit with a short descriptive message, and push to the remote.

## Task

### Phase 1: Lint

1. Run `pnpm lint` once to collect all ESLint errors and warnings. Note the specific file paths that have issues.
2. Fix the issues in the source files.
3. Re-run ESLint on **only the files that had errors/warnings**: `npx eslint --cache --cache-location node_modules/.cache/eslint/ --fix <file1> <file2> ...`
4. Repeat steps 2-3 until those files pass with zero errors and zero warnings.
5. **Never run `pnpm lint` (full project) a second time** — it is too slow. Only re-check the specific files you touched.

### Phase 2: Typecheck

1. Run `tsc --noEmit` once to collect all TypeScript errors. Note the specific file paths that have issues.
2. Fix the issues in the source files.
3. Re-run typecheck on **only the files that had errors**: `tsc --noEmit` (tsc cannot reliably check a subset while honoring tsconfig.json; run the full check only in the final verification step).
4. Repeat until those files pass with zero errors.
5. **Never run `tsc --noEmit` (full project) a second time** during this phase — only re-check after all your fixes are in for the final Phase 3 verification.

### Phase 3: Commit & Push

1. Run `git status` to see all changes (staged, unstaged, untracked). If there are no changes, inform the user and stop.
2. Run `git diff` and `git diff --cached` to understand what changed.
3. Run `git log --oneline -5` to match the repo's commit message style.
4. Stage all changes with `git add -A`.
5. Write a commit message that is:
    - As short as possible (ideally under 50 characters)
    - Descriptive of _what_ changed, not _how_
    - In imperative mood (e.g., "add", "fix", "update", "remove")
    - Without a trailing period
    - Ending with the co-author line
6. Commit using a HEREDOC:

    ```
    git commit -m "$(cat <<'EOF'
    <message>

    Co-Authored-By: Claude <noreply@anthropic.com>
    EOF
    )"
    ```

7. Push to the remote with `git push`. If no upstream is set, use `git push -u origin HEAD`.

## Constraints

- Never amend an existing commit.
- Never force push.
- If a pre-commit hook fails, fix the issue, re-stage, and create a new commit.
- Do not skip hooks (no `--no-verify`).
- If there are no changes to commit, do not create an empty commit — just inform the user.
- Keep iterating on lint/typecheck until ALL issues (errors AND warnings) are resolved before moving to the commit phase.
