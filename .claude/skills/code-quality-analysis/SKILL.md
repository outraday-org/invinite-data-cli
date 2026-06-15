---
name: code-quality-analysis
description: |
    Analyzes code quality, reusability, and type patterns for the CLI codebase. Use this skill when:
    - User mentions "code quality", "complexity", "tech debt", or "maintainability"
    - User asks about "duplicates", "reusability", "deduplication", or "type patterns"
    - User asks about Zod schema extraction or `z.infer` patterns
    - Before/after refactoring or when reviewing code changes
allowed-tools: Bash, Read, Glob, Grep, Edit, Write
---

# Code Quality & Reusability Analysis

You are an expert code quality analyzer combining PMAT static analysis, reusability/deduplication scanning, and CLI type pattern enforcement for this codebase.

## When to Activate

1. User asks about code quality, complexity, tech debt, or maintainability
2. User asks about duplicates, reusability, or "search before creating"
3. User asks about Zod schema patterns, validator extraction, or `z.infer`
4. Before/after refactoring or when reviewing code changes

## Section 1: PMAT Static Analysis

### Commands

| Command                                 | Purpose                                           |
| --------------------------------------- | ------------------------------------------------- |
| `pmat analyze quality --path <path>`    | Overall health score, complexity, maintainability |
| `pmat analyze complexity --path <path>` | Cyclomatic + cognitive complexity per function    |
| `pmat analyze dead-code --path <path>`  | Unused functions, variables, imports              |
| `pmat analyze satd --path <path>`       | TODO, FIXME, HACK comment detection               |

### Thresholds

| Metric                | Threshold   | Action                      |
| --------------------- | ----------- | --------------------------- |
| Cyclomatic complexity | >10         | Refactor — extract methods  |
| Cognitive complexity  | >15         | High mental load — simplify |
| Maintainability index | <50         | Poor — needs attention      |
| SATD annotations      | >5 per file | High tech debt — triage     |

## Section 2: Reusability & Deduplication

### Scan Priorities

1. `src/commands/` — command handler duplication, repeated option patterns
2. `src/lib/` — utility function overlap, duplicate formatters
3. `src/api/` — API client and request pattern inconsistencies
4. `tests/` — test fixture and mock duplication

### What to Scan For

- **Duplicated logic**: Similar functions, copy-pasted patterns across files
- **Dead code**: Unused exports, unreachable branches, orphaned files
- **Inconsistent patterns**: Same thing done different ways (e.g., different
  error handling styles per command, inconsistent `--json` output shapes)
- **TODO/FIXME/HACK comments**: Deferred work (overlaps with PMAT SATD)
- **Over-engineering**: Unnecessary abstractions, unused flexibility
- **Duplicated Zod schemas**: Same option shape defined in multiple command files
  when it should live in `src/lib/`

### Search-Before-Creating Checklist

Before creating anything new, check these locations:

| Looking for…        | Search first                                    |
| ------------------- | ----------------------------------------------- |
| CLI helpers         | `src/lib/`, `src/api/`                          |
| Output formatters   | `src/lib/formatters/` or nearest formatters dir |
| Config access       | `src/lib/config.ts` or nearest config helper    |
| API client          | `src/api/client.ts` or nearest client file      |
| Zod schemas/types   | `src/lib/` for shared, co-located for command   |
| Commander utilities | `src/lib/commander/` or nearest commander dir   |

### Detection Commands

```bash
# Duplicate Zod schema names across command files
grep -r "z\.object(" src/commands/ | grep -v "node_modules"

# Duplicate formatter functions
grep -r "export.*format" src/commands/ src/lib/

# Orphaned exports (exported but never imported)
# For each export name, check if imported anywhere
grep -r "^export" src/ | grep -v "node_modules"
```

### Best Practices

- Focus on patterns that cause real maintenance burden, not cosmetic issues
- Prefer extracting shared abstractions over picking one duplicate as canonical
- Consider whether a "duplication" is actually intentional variation
- Group related findings by root cause
- Present as prioritized list with impact (high/medium/low)

## Section 3: CLI Type Pattern Enforcement

### Pattern A: Extracted Zod Schemas

```typescript
// GOOD — extracted to src/lib/schemas/companySearch.ts
import { z } from "zod";

export const CompanySearchOptionsSchema = z.object({
    query: z.string().min(1),
    limit: z.number().int().positive().default(10),
    offset: z.number().int().nonneg().default(0),
});
export type CompanySearchOptions = z.infer<typeof CompanySearchOptionsSchema>;
```

**Rules:**

- `Schema` suffix on all Zod schema objects (`CompanySearchOptionsSchema`)
- Derive types with `z.infer<typeof XxxSchema>` — never write types manually
- Place shared schemas in `src/lib/` or `src/api/`
- Command-specific schemas can live alongside their command file

### Pattern B: Commander Option Validation

```typescript
// GOOD — validate before use
const opts = CompanySearchOptionsSchema.parse(options);
```

```typescript
// BAD — using raw commander options without validation
const { query, limit } = options; // types are string | undefined
```

### Pattern C: Consistent Error Handling

```typescript
// GOOD — consistent exit code + user-actionable message
try {
    // ...
} catch (error) {
    console.error(chalk.red("Error:"), error instanceof Error ? error.message : String(error));
    process.exit(1);
}
```

### Pattern D: `--json` Output

```typescript
// GOOD — consistent JSON output when --json is passed
if (options.json) {
    console.log(JSON.stringify(data, null, 2));
    return;
}
// default table output
```

### Anti-Patterns to Flag

| Anti-pattern | Fix |
| --- | --- |
| Inline `z.object({...})` used in multiple command files | Extract to `src/lib/schemas/` |
| Manually written option types instead of `z.infer` | Derive from Zod schema |
| Missing Zod validation for Commander options | Add `.parse(options)` |
| `process.exit(0)` after an error log | Change to `process.exit(1)` |
| API key or secret printed to stdout | Remove — use masked output or omit |
| `console.log` on error paths | Use `console.error` + non-zero exit |
| Raw `error.message` in user output (may expose internals) | Wrap in a user-friendly message |

## Section 4: Quick Checklist

```
[ ] PMAT quality + complexity on changed files
[ ] SATD: check for new TODO/FIXME/HACK
[ ] Duplicates: grep schema/formatter/helper names across src/
[ ] Schemas: no new inline z.object({}) across multiple command files
[ ] Types: new schemas use z.infer<typeof XxxSchema> in lib/ files
[ ] Error handling: exit 1 on error, exit 0 on success
[ ] Output: --json supported for data commands
[ ] Config: new conf keys have sensible defaults and are reset/shown correctly
```
