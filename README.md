# Rover

AI-powered codebase scanner with multi-agent validation.

Rover scans your codebase using 33 specialized AI agents to detect code quality issues, security vulnerabilities, architectural problems, and anti-patterns. Issues are validated through a 3-phase consensus pipeline before being saved as tickets.

## How It Works

Scans use a 3-phase AI pipeline:

1. **Scanner** - A specialized agent analyzes the codebase and proposes candidate issues
2. **Voters** - Three independent voter agents evaluate each proposed issue
3. **Arbitrator** - Tallies votes and creates tickets for approved issues (requires 2+ votes to pass)

This multi-agent validation reduces false positives and ensures issues are worth addressing.

## Requirements

- Node.js
- pnpm
- `ANTHROPIC_API_KEY` environment variable

## Installation

```bash
git clone https://github.com/varun-tandon/rover.git
cd rover
pnpm install
pnpm build
```

## Quick Start

```bash
# Set your API key
export ANTHROPIC_API_KEY=your-key-here

# Scan current directory with the default agent (security-auditor)
rover scan .

# Run a full scan with all 33 agents
rover scan . --all

# View detected issues
rover issues

# Auto-fix an issue
rover fix ISSUE-001

# Create a PR for the fix
rover review submit ISSUE-001
```

## Commands

### scan

Run AI agents to scan a codebase and create issue tickets.

```bash
rover scan <path> [options]
```

**Options:**
- `--all` - Run all 33 agents (recommended for thorough analysis)
- `-a, --agent <id>` - Run a specific agent by ID (default: security-auditor)
- `--concurrency <n>` - Agents to run in parallel with --all (default: 8)
- `--dry-run` - Preview what would be scanned without running
- `--verbose` - Show detailed output during scan

**Examples:**
```bash
rover scan ./my-project                 # Scan with default agent
rover scan ./my-project --all           # Full scan with all 33 agents
rover scan . -a dead-code-detector      # Run specific agent
rover scan ./app --all --concurrency=2  # Use fewer parallel agents
```

Batch runs with `--all` can be resumed if interrupted.

### fix

Auto-fix issues using Claude with iterative code review.

```bash
rover fix <id>... [options]
```

**Workflow:**
1. Creates a git worktree with branch `fix/ISSUE-XXX`
2. Claude analyzes the issue and implements a fix
3. Claude commits the changes
4. A code review runs on the changes
5. If review finds issues, Claude addresses them
6. Steps 3-5 repeat until review passes (or max iterations hit)
7. Worktree is left in place for you to create a PR

**Options:**
- `--concurrency <n>` - Issues to fix in parallel (default: 8)
- `--max-iterations <n>` - Max review cycles per issue (default: 10)
- `--verbose` - Stream all Claude output for debugging

**Examples:**
```bash
rover fix ISSUE-001                    # Fix a single issue
rover fix ISSUE-001 ISSUE-002          # Fix multiple issues in parallel
rover fix ISSUE-001 --max-iterations=3 # Limit review iterations
rover fix ISSUE-001 --verbose          # See all Claude output
```

### review

List completed fixes and create pull requests.

```bash
rover review [list|submit|clean] [id] [options]
```

**Subcommands:**
- `list` - List all fixes with their status (default)
- `submit <id>` - Create a PR for a specific fix
- `submit --all` - Create PRs for all ready fixes
- `clean <id>` - Remove a fix worktree and its record
- `clean --all` - Remove all fix worktrees and records

**Options:**
- `--all` - Submit PRs / clean all fixes
- `--draft` - Create draft PRs instead of regular PRs

**Examples:**
```bash
rover review list                     # See all completed fixes
rover review submit ISSUE-001         # Create PR for one fix
rover review submit --all             # Create PRs for all ready fixes
rover review submit ISSUE-001 --draft # Create a draft PR
rover review clean ISSUE-001          # Remove worktree after merge
```

### issues

List, view, copy, or remove stored issue tickets.

```bash
rover issues [view|copy|remove|ignore] [id] [options]
```

**Subcommands:**
- (default) - List all issues (shows ID, severity, title)
- `view <id>` - Print full issue content to stdout
- `copy <id>` - Copy issue content to clipboard (macOS)
- `remove <id>...` - Delete issues by ID (removes ticket and history)
- `ignore <id>...` - Mark issues as "won't fix" (hides but prevents re-detection)

**Options:**
- `-s, --severity <level>` - Filter by severity: low, medium, high, critical
- `--all` - Include ignored ("won't fix") issues in the list

**Examples:**
```bash
rover issues                             # List all issues
rover issues --severity critical         # Show only critical issues
rover issues view ISSUE-042              # View issue details
rover issues copy ISSUE-042              # Copy to clipboard for sharing
rover issues remove ISSUE-001 ISSUE-002  # Remove resolved issues
rover issues ignore ISSUE-003            # Mark as "won't fix"
```

### consolidate

Find and merge duplicate/related issues using AI.

```bash
rover consolidate [path] [options]
```

**Options:**
- `--dry-run` - Preview what would be consolidated without making changes
- `--concurrency <n>` - Clusters to process in parallel (default: 8)

**Examples:**
```bash
rover consolidate               # Consolidate in current directory
rover consolidate ./my-project  # Consolidate in specific path
rover consolidate --dry-run     # Preview consolidation
```

### plan

Generate prioritized work plan with dependency graph.

```bash
rover plan [path]
```

Selects the top 10 highest priority issues and analyzes their dependencies. Outputs a Mermaid diagram showing which issues can be worked on in parallel and which have dependencies.

The plan is saved to `.rover/plans/` as a markdown file with:
- Priority issue table
- Dependency analysis summary
- Mermaid flowchart diagram
- Recommended execution order
- Parallel workstream assignments

**Examples:**
```bash
rover plan              # Plan for current directory
rover plan ./my-project # Plan for specific path
```

### agents

List all available scanning agents with descriptions.

```bash
rover agents
```

### remember

Store context in memory to help agents ignore known issues.

```bash
rover remember "<text>"
```

Memory is included in agent prompts to provide context about intentional decisions, known issues, or patterns that should not be flagged. Use this to reduce false positives.

**Examples:**
```bash
rover remember "Using 'any' type in api-client.ts is intentional for dynamic responses"
rover remember "Large bundle size in analytics.ts is acceptable - vendor SDK"
rover remember "Duplicate code in adapters/ is intentional for isolation"
```

## Available Agents

Rover includes 33 specialized scanning agents organized by category:

| Category | Agents |
|----------|--------|
| Architecture (5) | depth-gauge, generalizer, cohesion-analyzer, layer-petrifier, boilerplate-buster |
| Code Clarity (4) | obviousness-auditor, why-asker, naming-renovator, interface-documenter |
| Consistency (1) | consistency-cop |
| Bug Detection (2) | exception-auditor, logic-detective |
| Config (1) | config-cleaner |
| Performance (2) | query-optimizer, async-efficiency-auditor |
| Dependencies (1) | dependency-auditor |
| Code Health (3) | dead-code-detector, complexity-analyzer, duplication-finder |
| API (1) | api-contract-validator |
| Security (1) | security-auditor |
| TypeScript (1) | typescript-quality-auditor |
| React (1) | react-patterns-auditor |
| Next.js (10) | client-boundary-optimizer, server-action-auditor, data-fetching-strategist, route-segment-analyzer, nextjs-asset-optimizer, nextjs-rendering-optimizer, hydration-mismatch-detector, navigation-pattern-enforcer, metadata-checker, bundle-performance-auditor |

Run `rover agents` to see full descriptions of each agent.

## Output Files

All data is stored in the `.rover/` directory:

| Path | Description |
|------|-------------|
| `.rover/tickets/` | Individual issue Markdown files (ISSUE-XXX.md) |
| `.rover/issues.json` | Issue history for deduplication across runs |
| `.rover/memory.md` | User-provided context for agents |
| `.rover/run-state.json` | Tracks batch run progress for resume capability |
| `.rover/fix-state.json` | Tracks fix workflow state and PR status |
| `.rover/plans/` | Work plans with Mermaid dependency diagrams |

## Development

```bash
pnpm dev        # Run in development mode (tsx)
pnpm build      # Build for production
pnpm typecheck  # Type check without emitting
```
