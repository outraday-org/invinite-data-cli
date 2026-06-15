---
name: create-PR-and-merge
description: |
    Creates a PR for the current branch into the default branch, resolves merge conflicts
    preserving changes from both branches, and merges. Use when you want to open a PR and
    merge it in one step, handling any conflicts safely with user clarification.
---

# Create PR and Merge

Create a pull request for the current branch into the default (main) branch, resolve any
merge conflicts without losing work from either branch, and merge the PR.

## Workflow

### 1. Pre-flight Checks

Run these checks before doing anything:

```bash
# Ensure working tree is clean — commit or warn if not
git status

# Identify the default branch
git remote show origin | grep 'HEAD branch'

# Ensure current branch is pushed to remote
git log @{u}..HEAD 2>/dev/null
```

- If there are uncommitted changes, ask the user whether to commit them first or abort.
- If the branch has unpushed commits, push them with `git push -u origin HEAD`.

### 2. Fetch Latest Default Branch

```bash
git fetch origin main
```

### 3. Check for Merge Conflicts

Attempt a trial merge locally to detect conflicts _before_ creating the PR:

```bash
# Dry-run merge (do NOT commit)
git merge --no-commit --no-ff origin/main
```

- **No conflicts** → undo the merge (`git merge --abort`) and skip to Step 5.
- **Conflicts detected** → proceed to Step 4.

### 4. Resolve Merge Conflicts

For each conflicted file:

1. **Read the file** with conflict markers using the `Read` tool.
2. **Analyze the conflict** — determine whether changes from both sides can coexist.
3. **If the resolution is obvious** (e.g., additive changes to different sections, import
   additions, non-overlapping edits), resolve it by keeping changes from **both** branches
   using the `Edit` tool.
4. **If the resolution is ambiguous** (e.g., both branches modified the same lines with
   different intent), use the `AskUserQuestion` tool to ask the user which version to keep
   or how to combine them. Present the conflicting hunks as preview options so the user can
   compare.

**Golden rule:** Never discard changes from either branch without explicit user approval.

After all conflicts are resolved:

```bash
git add -A
git commit -m "Merge origin/main into <branch> — resolve conflicts"
git push
```

If the merge was from the dry-run, abort it first (`git merge --abort`), then redo the
real merge after resolving.

### 5. Create the Pull Request

Use `gh` CLI to create the PR:

```bash
gh pr create \
  --title "<concise PR title based on branch changes>" \
  --body "$(cat <<'EOF'
## Summary
<bullet points summarizing branch changes>

## Merge conflicts
<"None" or brief description of resolved conflicts>

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

- Derive the title and summary from `git log main..HEAD --oneline`.
- Keep the title under 70 characters.

### 6. Merge the Pull Request

```bash
gh pr merge --merge --delete-branch
```

- Use `--merge` (not squash or rebase) to preserve full commit history.
- `--delete-branch` cleans up the remote feature branch after merge.
- If merge fails due to new conflicts (someone pushed to main in the meantime), go back
  to Step 2 and repeat.

### 7. Post-merge Cleanup

```bash
git checkout main
git pull origin main
```

## Conflict Resolution Strategy

| Scenario                                           | Action                          |
| -------------------------------------------------- | ------------------------------- |
| Both branches add different lines in the same area | Keep both additions             |
| Both branches modify the same line differently     | Ask user via `AskUserQuestion`  |
| One branch deletes code the other modifies         | Ask user via `AskUserQuestion`  |
| Import / dependency additions from both sides      | Keep all imports from both      |
| Schema or config changes on both sides             | Merge carefully, ask if unclear |

## Error Handling

- **Dirty working tree:** Ask user to commit or stash before proceeding.
- **Branch not pushed:** Push automatically with `git push -u origin HEAD`.
- **PR creation fails:** Show the error and ask the user how to proceed.
- **Merge blocked by CI:** Inform the user and wait for their decision.
- **Rate limits / auth issues:** Surface the error clearly.

## Checklist

- [ ] Working tree is clean
- [ ] Branch is pushed to remote
- [ ] Latest default branch is fetched
- [ ] Merge conflicts resolved (if any) preserving both sides
- [ ] PR created with descriptive title and summary
- [ ] PR merged successfully
- [ ] Local checkout switched to main and pulled
