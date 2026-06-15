---
description: Create a new command.
model: opus
---

# Create Command

## Purpose

You are a command creation specialist focused on building new executable commands for the Claude Code system. Your task is to create well-structured command files that orchestrate workflows, delegate to subagents, and provide clear instructions for specific development tasks.

## Task

1. Understand the command requirements and what workflow it should orchestrate
2. Create the command file with proper frontmatter configuration
3. Write clear, directive instructions for the LLM to follow
4. Configure appropriate model settings and hooks
5. Define subagent delegation strategy if applicable

## File Structure

Commands are located in `.claude/commands/` as individual markdown files:

```
.claude/commands/
├── build.md
├── plan-and-build.md
├── create-skill.md
├── execute-tasklist.md
└── <command-name>.md    # Kebab-case filename
```

**Important Naming Conventions:**

- Filename: Use kebab-case with `.md` extension (e.g., `create-feature.md`, `run-tests.md`)
- Commands are invoked by their filename without extension

## Frontmatter Format

Every command file must start with YAML frontmatter:

```yaml
---
description: Brief description of what this command does.
model: opus
---
```

**Frontmatter Fields:**

- `description`: Clear, concise description of the command's purpose (required)
- `model`: AI model to use (`opus`, `sonnet`, or `haiku`)
- `hooks`: Optional hooks that run at specific events (e.g., `Stop` hook runs when command completes)

**Model Selection Guidelines:**

- `opus`: Most capable model, use for complex tasks requiring deep reasoning
- `sonnet`: Balanced model, good for most tasks (default for production work)
- `haiku`: Fast model, use for simple, straightforward tasks

**Common Hooks:**

- `Stop`: Runs when the command completes (e.g., quality checks, linting, type checking)

## Command Content Structure

After the frontmatter, structure your command instructions using this format:

### 1. Title (H1)

```markdown
# Command Name
```

### 2. Purpose Section

Define the role and primary objective:

```markdown
## Purpose

You are a [role] specializing in [capability]. Your task is to [objective].
```

### 3. Task Section

List numbered steps outlining what to do:

```markdown
## Task

1. [First major step]
2. [Second major step]
3. [Third major step]
```

### 4. Execution Strategy Section

Provide specific guidance on how to approach the work:

```markdown
## Execution Strategy

- **Key Aspect 1**: Details about approach
- **Key Aspect 2**: Details about delegation
- **Parallelization**: Guidelines for running subagents in parallel
```

### 5. Constraints Section

Define hard limits and requirements:

```markdown
## Constraints

- Maximum of X parallel subagents at any time
- All code must be written in English
- Never hard-code text without internationalization
```

### 6. Best Practices Section

Provide recommendations for quality work:

```markdown
## Best Practices

- Specific recommendation 1
- Specific recommendation 2
- Specific recommendation 3
```

## Subagent Delegation Patterns

Commands often delegate work to specialized subagents. Common patterns:

### File Discovery

```markdown
- **File Discovery**: Use `file-discovery-specialist` subagents to locate relevant files before making changes
```

### Code Implementation

```markdown
- **Implementation**: Use `code-implementer` subagents to write code following project patterns
- **Parallelization**: Run up to 5 subagents in parallel when implementing independent features
```

### Validation and Review

```markdown
- **Validation**: Always run `code-review-validator` after completing implementation to ensure quality
- **Optimization**: Use `code-optimizer` subagents when performance or code quality improvements are needed
```

### Debugging

```markdown
- **Debugging**: Use `root-cause-debugger` subagents to investigate and resolve issues
- **Delegation**: Assign issues to subagents intelligently to avoid conflicts and overlapping work
```

## Example Command

```markdown
---
description: Implement new features with validation.
model: opus
---

# Implement Feature Command

## Purpose

You are a feature implementation specialist focused on building new functionality with high code quality. Your task is to implement features according to specifications while ensuring proper testing and validation.

## Task

1. Understand the feature requirements thoroughly
2. Discover relevant files using specialized subagents
3. Implement the feature using code implementer subagents
4. Validate changes with code review subagents
5. Ensure all internationalization requirements are met

## Execution Strategy

- **Discovery**: Use `file-discovery-specialist` subagents to locate relevant files
- **Implementation**: Use `code-implementer` subagents for writing code
- **Parallelization**: Run up to 5 subagents in parallel for independent components
- **Validation**: Always validate with `code-review-validator` before completion

## Constraints

- Maximum of 5 parallel subagents at any time
- All code and comments must be written in English
- Follow existing code patterns and conventions

## Best Practices

- Read existing code before making changes to understand patterns
- Use the `add-translation` skill for all user-facing text
- Write clean, maintainable code with proper TypeScript types
- Consider test coverage for new features
- Document complex logic with clear comments
```

## Execution Strategy

**Discovery Phase:**

1. Examine existing commands in `.claude/commands/` to understand patterns
2. Identify the workflow the command should orchestrate
3. Determine which subagents will be needed

**Creation Phase:**

1. Create file: `.claude/commands/<command-name>.md`
2. Add frontmatter with description, model, and hooks
3. Write command instructions following the structured format
4. Define clear delegation patterns for subagents

**Validation Phase:**

1. Verify frontmatter is properly formatted
2. Ensure instructions are clear and directive
3. Confirm subagent delegation strategy is well-defined
4. Test that the command can be invoked

## Commands Directory Location

**Commands Location:** `.claude/commands/`

Each command is a single markdown file in this directory.

**Related Configuration:**

- `.claude/settings.json` - Global Claude Code settings and permissions
- `.claude/agents/` - Agent configuration files
- `.claude/skills/` - Reusable skill documentation that commands can reference

## Provider Mirrors (REQUIRED)

`.claude/` is the canonical source. Every new command MUST be mirrored to the other providers in the same task, per the "Provider Mirror Rules" in root `CLAUDE.md`. Skipping mirrors leaves the command invisible to Cursor, Codex, and the generic `.agent/` provider.

For a new `.claude/commands/<name>.md`, create all three mirrors:

1. **Cursor** — symlink `.cursor/commands/<name>.md` → `../../.claude/commands/<name>.md`
2. **Generic agent** — symlink `.agent/commands/<name>.md` → `../../.claude/commands/<name>.md`
3. **Codex** — wrapper skill at `.codex/skills/<name>/`:
    - `.codex/skills/<name>/SKILL.md` (thin wrapper, see template below)
    - `.codex/skills/<name>/references/command.md` symlinked → `../../../../.claude/commands/<name>.md`

**Codex `SKILL.md` template** (kept thin — never duplicate command body here):

```markdown
---
name: <name>
description: <same description as the .claude command>. Use when the user wants <trigger>.
---

Read `references/command.md` and follow that workflow in Codex.

Adapt the referenced Claude command for Codex:

- Treat the command file as workflow guidance, not as skill metadata.
- Ignore Claude-only frontmatter such as `model` or `tools`.
- Replace Claude-specific slash-command or subagent steps with the closest direct Codex workflow.
```

**Creating symlinks on Windows:** `core.symlinks=false` means symlinks appear as text files containing the relative target path on checkout, but git tracks them as mode 120000 and they resolve as real symlinks on Unix. Use `git update-index --add --cacheinfo 120000,<sha>,<path>` or commit the link from a Unix checkout if `ln -s` is unavailable. Verify with `git ls-files -s <path>` — the mode column must read `120000`.

**Renames and deletions:** If you rename or delete `.claude/commands/<name>.md`, update or delete all three mirrors in the same commit. Orphaned symlinks under `references/` must also be cleaned up.

## Constraints

- Command files must use `.md` extension
- Filenames must use kebab-case
- Frontmatter must be valid YAML
- Instructions must be written in second person ("You are...", "Your task is...")
- Always use imperative, directive language
- Specify maximum subagent parallelization limits

## Common Command Types

- **build**: Build or implement features with code changes
- **debug**: Debug and fix issues with root cause analysis
- **detailed-plan**: Create comprehensive implementation plans
- **create-\***: Create new components (skills, commands, features)
- **test**: Run tests and validate functionality
- **deploy**: Deploy or publish changes

## Hook Configuration

Hooks run at specific lifecycle events. The most common hook is `Stop`:

```yaml
hooks:
    Stop:
        type: command
        command: node .claude/hooks/node-type-check/quality-check.js
```

**Available Hook Types:**

- `command`: Run a shell command
- Other types may be available depending on Claude Code version

**Hook Timing:**

- `Stop`: Runs when the command completes (useful for validation, linting, type checking)

## Best Practices

**Command Design:**

- Keep commands focused on a single workflow or task type
- Delegate complex work to specialized subagents
- Define clear success criteria
- Include validation steps

**Language and Tone:**

- Use second person imperative ("You are...", "Your task is...")
- Be specific and directive
- Avoid ambiguous instructions
- State requirements clearly

**Subagent Usage:**

- Always specify maximum parallelization limits (typically 5)
- Assign work intelligently to avoid conflicts
- Use specialized subagents for their specific purposes
- Validate work after completion

**Error Handling:**

- Include constraints about what not to do
- Specify required patterns and conventions
- Define quality requirements
- Mention validation steps

## Model Selection Strategy

Choose the appropriate model based on task complexity:

- **opus**: Complex reasoning, architectural decisions, multi-step planning
- **sonnet**: Most development tasks, balanced cost/performance
- **haiku**: Simple tasks, quick validations, straightforward operations

Commands can specify `model: opus` in frontmatter to ensure adequate capability for complex tasks.
