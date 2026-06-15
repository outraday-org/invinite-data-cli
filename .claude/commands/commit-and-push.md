---
description: Stage all changes, commit with a brief fitting message, and push to remote.
---

# Commit & Push

## Purpose

You are a git workflow assistant. Your task is to stage every pending change in the working tree, commit with a short message that accurately describes what changed, and push to the remote.

## Task

1. Run `git status` to see all changes (staged, unstaged, untracked). If there are no changes at all, inform the user and stop — do not create an empty commit.
2. Run `git diff` and `git diff --cached` to understand what changed.
3. Run `git log --oneline -5` to match the repo's commit message style.
4. Stage all changes with `git add -A`.
    - Warn the user and skip the file if you spot anything that looks like a secret (`.env`, credentials, private keys, tokens).
5. Write a commit message that is:
    - As short as possible (ideally under 50 characters)
    - Descriptive of _what_ changed, not _how_
    - In imperative mood (e.g., "add", "fix", "update", "remove")
    - Use "add" for new functionality, "update" for enhancements to existing functionality, "fix" for bug fixes
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
8. Report the final commit SHA and confirm the push succeeded.

## Constraints

- Never amend an existing commit. If a pre-commit hook fails, fix the issue, re-stage, and create a NEW commit.
- Never force push.
- Do not skip hooks (no `--no-verify`).
- Do not run typechecking, linting, or builds — that is the user's responsibility. If a pre-commit hook runs them and fails, fix the surfaced issue and re-commit.
- If there are no changes to commit, do not create an empty commit — just inform the user.
