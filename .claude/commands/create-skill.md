---
description: Create a new skill.
model: opus
---

# Create Skill Command

## Purpose

You are a skill creation specialist focused on building new reusable skills for the Claude Code system. Your task is to create well-documented, structured skills that can be invoked via slash commands (e.g., `/skill-name`) to guide implementation of specific patterns or features.

## Task

1. Understand the skill requirements and what pattern or workflow it should document
2. Create the skill directory and file structure
3. Write comprehensive, step-by-step documentation in the skill file
4. Include code examples, file paths, and checklists
5. Add proper frontmatter with name and description

## File Structure

Skills are located in `.claude/skills/` with the following structure:

```
.claude/skills/
└── <skill-name>/          # Kebab-case directory name
    └── SKILL.md           # Uppercase filename (required)
```

**Important Naming Conventions:**

- Directory name: Use kebab-case (e.g., `add-command`, `explain-config`)
- Skill file: Must be named `SKILL.md` (uppercase)
- The skill name in frontmatter should match the directory name

## Frontmatter Format

Every skill file must start with YAML frontmatter:

```yaml
---
name: skill-name
description: Brief description of what this skill does and when to use it.
---
```

**Frontmatter Fields:**

- `name`: Kebab-case skill name matching the directory (required)
- `description`: Clear, concise description of the skill's purpose and when to invoke it (required)

## Skill Content Structure

After the frontmatter, structure your skill documentation as follows:

### 1. Title and Introduction

- Start with a clear H1 title
- Provide a brief overview of what the skill accomplishes

### 2. Architecture Overview (if applicable)

- Include diagrams or folder structure for complex patterns
- Explain how the components fit together

### 3. Step-by-Step Guide

- Number each major step clearly
- Include file paths for every code example
- Show exact code snippets with proper syntax highlighting
- Use inline comments to highlight additions (`// <- add` or `// <-- ADD`)

### 4. Code Examples

- Always include complete, working examples
- Show imports and full context
- Use proper TypeScript types and patterns from the codebase
- Reference existing files as examples when possible

### 5. File Checklist

- End with a checklist of all files that need to be created or modified
- Use checkbox format: `- [ ] path/to/file.ts - Description`

## Best Practices

**Documentation Quality:**

- Write in imperative mood ("Add the shape type", not "You should add")
- Be specific with file paths (absolute paths from project root)
- Include command, validation, and output considerations
- Explain "why" for architectural decisions, not just "what"

**Code Examples:**

- Use real patterns from the existing codebase
- Show full import statements
- Include type definitions and validation
- Demonstrate proper error handling

**Organization:**

- Group related steps together
- Use clear section headers (H2, H3)
- Keep examples close to their explanations
- Cross-reference related skills when applicable

**Maintenance:**

- Keep examples up-to-date with current codebase patterns
- Reference specific files that serve as good examples
- Include version-specific notes if patterns change

## Example Skill Structure

```markdown
---
name: add-feature-x
description: Guide for adding feature X including its command, Zod validation, and output. Use when implementing feature X.
---

# Add Feature X

This skill guides you through adding feature X to the project.

## Overview

Feature X requires:

1. A Commander command
2. Zod argument validation
3. Formatted output (chalk / ora)

## Step-by-Step Guide

### 1. Add the Command

\`\`\`typescript
// src/commands/featureX.ts
import type { Command } from "commander";
import { z } from "zod";

const argsSchema = z.object({ id: z.string() });

export const registerFeatureXCommand = (program: Command) => {
program
.command("feature-x <id>")
.description("Fetch feature X")
.action(async (id: string) => {
const parsed = argsSchema.safeParse({ id });
if (!parsed.success) {
process.exitCode = 1;
return;
}
// ... call the API client, then print the result
});
};
\`\`\`

### 2. Register It

\`\`\`typescript
// bin/invinite.ts
registerFeatureXCommand(program);
\`\`\`

## File Checklist

- [ ] `src/commands/featureX.ts` - Command definition
- [ ] `bin/invinite.ts` - Command registration
```

## Execution Strategy

**Discovery Phase:**

1. Examine existing skills in `.claude/skills/` to understand patterns
2. Identify similar features or components that can serve as examples
3. Gather requirements for what the skill should document

**Creation Phase:**

1. Create directory: `.claude/skills/<skill-name>/`
2. Create file: `.claude/skills/<skill-name>/SKILL.md`
3. Add frontmatter with name and description
4. Write comprehensive documentation following the structure above

**Validation Phase:**

1. Verify all file paths are correct and match current codebase structure
2. Test code examples for syntax correctness
3. Ensure checklist is complete
4. Confirm the skill can be invoked via `/skill-name`

## Skills Directory Location

**Skills Location:** `.claude/skills/`

Each skill lives in its own subdirectory with the `SKILL.md` file containing all documentation.

**Related Files:**

- `.cursor/rules/` - Contains similar `.mdc` documentation files (legacy format)
- `.claude/commands/` - Contains command files that orchestrate skills

## Provider Mirrors (REQUIRED)

`.claude/` is the canonical source. Every new skill MUST be mirrored to the other providers in the same task, per the "Provider Mirror Rules" in root `CLAUDE.md`. Skipping mirrors leaves the skill invisible to Cursor, Codex, and the generic `.agent/` provider.

For a new `.claude/skills/<name>/SKILL.md`, create three mirror skill directories, each with `SKILL.md` symlinked back to the canonical file:

1. **Cursor** — `.cursor/skills/<name>/SKILL.md` → `../../../.claude/skills/<name>/SKILL.md`
2. **Codex** — `.codex/skills/<name>/SKILL.md` → `../../../.claude/skills/<name>/SKILL.md`
3. **Generic agent** — `.agent/skills/<name>/SKILL.md` → `../../../.claude/skills/<name>/SKILL.md`

The directories themselves are real directories; only the `SKILL.md` inside each is a symlink.

**Creating symlinks on Windows:** `core.symlinks=false` means symlinks appear as text files containing the relative target path on checkout, but git tracks them as mode 120000 and they resolve as real symlinks on Unix. Use `git update-index --add --cacheinfo 120000,<sha>,<path>` or commit the link from a Unix checkout if `ln -s` is unavailable. Verify with `git ls-files -s <path>` — the mode column must read `120000`.

**Renames and deletions:** If you rename or delete `.claude/skills/<name>/`, update or delete all three mirror directories in the same commit.

## Constraints

- Skill files must be named `SKILL.md` (uppercase)
- Directory names must use kebab-case
- Frontmatter name must match directory name
- All code examples must use TypeScript with proper types
- File paths must be absolute from project root
- Always include a file checklist at the end

## Common Skill Types

- **add-\***: Skills for adding new components (e.g., `add-command`)
- **create-\***: Skills for creating new features
- **explain-\***: Skills that explain existing patterns (e.g., `invinite-data-cli`)
- **adjust-\***: Skills for modifying existing features

Choose the appropriate prefix based on the skill's purpose.
