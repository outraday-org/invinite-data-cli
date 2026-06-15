---
description: Fix merge conflicts thoroughly by merging both sides, then push. Never loses work from either branch.
model: opus
---

# Fix Merge Conflicts

## Purpose

You are a merge conflict resolution specialist. Your job is to resolve all
merge conflicts in the current branch by **truly merging both sides** — never
blindly accepting "ours" or "theirs". After resolving conflicts you must also
audit non-conflicting files for cross-side dependencies, then commit and push
so the PR can be merged in the GitHub UI.

## Task

1. **Understand the merge state** — run `git status` to see all conflicted and
   modified files. Run `git log --oneline --left-right HEAD...MERGE_HEAD` (or
   the equivalent for a rebase) to understand what each side changed.
2. **Honor explicit per-file overrides from the user.** If the user's arguments
   name a specific file and say to take one side entirely ("take PR 343's
   `X.ts`", "replace `Y` with main's version", "keep only our `Z`"), do
   exactly that for that file (`git checkout --ours <path>` or
   `git checkout --theirs <path>`, then `git add`). Overrides apply **only to
   the files the user explicitly names** — every other conflicted file, and
   every non-conflicted auto-merged file, is still a full merge per the rules
   below. Never generalize one override to sibling files.
3. **For every other conflicted file**, resolve the conflict by combining both
   sides:
    - Read the full file including conflict markers.
    - Understand the intent of **both** sides — read the surrounding context,
      check the commit messages, and look at related files.
    - Produce a merged result that preserves the intent of both branches.
    - **Never** use `git checkout --ours` or `git checkout --theirs` on an
      entire file (unless the user explicitly authorized that file in step 2).
      Only accept one side wholesale if you have verified the other side made
      zero meaningful changes to that file.
4. **Audit non-conflicting files for hidden breakage** (see checklist below).
5. **Verify the result** — run `mcp__ide__getDiagnostics` to check for
   TypeScript or lint errors introduced by the merge.
6. **Stage, commit, and push** — stage all resolved files, commit with a clear
   merge message, and `git push` so the PR is ready to merge in GitHub.

## Conflict Resolution Rules

- **Read both sides fully.** Never resolve a conflict by only reading one side.
- **Preserve all functionality.** If side A added a new command and side B
  refactored the surrounding code, the result must contain the new command
  adapted to the refactored code.
- **Respect renames and moves.** If one side renamed a file or moved code to a
  new location, apply the other side's changes at the new location — do not
  resurrect deleted files or duplicate code.
- **Preserve import changes from both sides.** Merge import blocks carefully:
  keep new imports from both branches, remove imports deleted by either side
  only if the corresponding usage was also removed.
- **Order matters.** When both sides added entries to an ordered list (array,
  enum, switch cases), include all entries and pick a sensible order.
- **Never silently drop code.** If you are unsure whether a piece of code is
  still needed, keep it and leave a `// TODO: verify after merge` comment
  rather than deleting it.

## Documentation Files (`README.md`, `*.md`)

Documentation conflicts are where blanket `--ours` / `--theirs` does the most
silent damage. Two agents writing docs on two branches almost always add
_different, additive_ context — new sections, new commands, new gotchas — that
the other side never saw. Taking one side wholesale deletes paragraphs of real
engineering knowledge.

**Default behavior for any `*.md` conflict is: merge by union, not by
replacement.** Unless the user explicitly told you to overwrite one side:

1. **Read both sides fully** — including the non-conflict lines around each
   conflict region, since docs often split a single concept across conflict
   and auto-merged paragraphs.
2. **Reconcile against the actual code that is being kept.** If the file
   documents a command or config field and the merge result keeps that
   implementation, the doc must describe it accurately. But that does not mean
   deleting every sentence that came from the other branch — most "other side"
   sentences are additive context that still apply.
3. **For each conflict region, classify every sentence on each side** as one
   of:
    - **Describes code being kept** — include it.
    - **Describes code being discarded** — drop or rewrite it.
    - **Additive context** (history, rationale, cross-references, edge-case
      notes that don't contradict the kept implementation) — **include it**.
4. **Weave additive content in** rather than appending a "from main:" block.
   A merged README should read like one voice, not a stitched-together diff.
5. **Never delete a whole new section** that only one side added just because
   the surrounding paragraph was conflicted. New sections are almost always
   pure additions.
6. **When two sides give different values for the same named constant or
   behavior**, pick the value that matches the code being kept — do **not**
   keep both values.
7. **When in doubt, keep more, not less.** A doc with a redundant sentence
   is trivially fixable; a doc with a silently dropped architectural note
   is not.

## Hidden Breakage Checklist (Non-Conflicting Files)

Git marks a file as conflicted only when both branches touched the **same
lines**. Many merge bugs come from files that Git auto-merged cleanly but are
actually broken. After resolving all marked conflicts, check for these:

### Imports & Exports

- Did one side **create new shared files** (utilities, helpers, types)?
  Check if the other side has code that should now import from those new files
  instead of duplicating logic.
- Did one side **rename or move** a module? Verify all import paths from the
  other side still resolve.

### Types & Interfaces

- Did one side **add a required field** to a shared type/interface? Ensure all
  callers from the other side supply the new field.
- Did one side **change a function signature** (new parameter, changed return
  type)? Update all call sites from the other side.

### Schema & Configuration

- Did one side **add a new command or config field**? Make sure
  registration/config files include entries from both sides.
- Did one side **add or change Zod schemas**? Verify all call sites match.

### CLI Surface

- Did one side **add new Commander options or subcommands**? Ensure
  registration files include all additions from both sides.
- Did one side **change output formatting**? Check for visual consistency.

### Tests

- Did one side **add or modify test fixtures/mocks**? Ensure they are
  compatible with the other side's changes.

## Execution Strategy

- **Discovery first**: Before touching any file, build a complete picture of
  what each branch did. Use `git log`, `git diff`, and file reads.
- **Resolve conflicts one file at a time**: Read the file, understand both
  sides, write the merged result, then move to the next file.
- **Audit breadth**: After all conflicts are resolved, do a sweep of the full
  diff (`git diff HEAD` or `git diff --cached`) and the hidden breakage
  checklist above.
- **Parallelize audits**: Use up to 5 subagents in parallel to audit different
  areas (types, imports, config, etc.) for hidden breakage.
- **Type-check before pushing**: Run `mcp__ide__getDiagnostics` to catch errors.
  Fix any issues before committing.

## Constraints

- **Never lose work from either branch.** This is the #1 priority.
- **Never use `git checkout --ours/--theirs` on entire files** unless either
  (a) the user's arguments explicitly named that file and told you to take
  one side, or (b) one side provably made zero changes.
- **An override for one file does not extend to its neighbors.**
- **Never use `git stash`** — commit or discard.
- **Never use `git reset --hard`** — resolve forward.
- Maximum of 5 parallel subagents at any time.
- Do not modify code unrelated to the merge — no drive-by refactors.
- Always push at the end so the PR can be merged from the GitHub UI.

## Commit & Push

After all conflicts are resolved and verified:

```
git add <all resolved files>
git commit -m "Merge conflict resolution: <brief summary of what was merged>"
git push
```

If the push fails because the remote is ahead, pull with `--no-rebase` and
resolve any new conflicts before pushing again.
