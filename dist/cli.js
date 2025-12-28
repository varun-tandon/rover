#!/usr/bin/env node
import { jsx as _jsx } from "react/jsx-runtime";
// Increase max listeners to handle concurrent agent queries.
// Each agent spawns multiple query() calls that add exit listeners.
// With 4 concurrent agents × 4 parallel queries = 16+ listeners needed.
process.setMaxListeners(50);
import { render } from 'ink';
import meow from 'meow';
import { createInterface } from 'node:readline';
import { resolve } from 'node:path';
import { readFile } from 'node:fs/promises';
import { execSync } from 'node:child_process';
import { App } from './components/App.js';
import { BatchApp } from './components/BatchApp.js';
import { IssuesList } from './components/IssuesList.js';
import { ConsolidateApp } from './components/ConsolidateApp.js';
import { FixApp } from './components/FixApp.js';
import { ReviewApp } from './components/ReviewApp.js';
import { getAgentIds, getAllAgents } from './agents/index.js';
import { runPlanner } from './agents/planner.js';
import { loadIssueStore, removeIssues, ignoreIssues, selectTopPriorityIssues } from './storage/issues.js';
import { getTicketPathById, extractTicketId } from './storage/tickets.js';
import { appendMemory } from './storage/memory.js';
import { loadRunState, isRunIncomplete, clearRunState } from './storage/run-state.js';
import { buildWorkPlan, savePlan } from './storage/plans.js';
/**
 * Prompt the user with a yes/no question via readline
 */
async function promptYesNo(question) {
    const rl = createInterface({
        input: process.stdin,
        output: process.stdout
    });
    return new Promise((resolvePromise) => {
        rl.question(question, (answer) => {
            rl.close();
            const normalized = answer.toLowerCase().trim();
            resolvePromise(normalized === 'y' || normalized === 'yes');
        });
    });
}
const cli = meow(`
  Scans use a 3-phase AI pipeline: (1) A scanner agent analyzes the codebase and
  proposes issues, (2) Three voter agents independently evaluate each proposed
  issue, (3) An arbitrator tallies votes and creates tickets for approved issues
  (requires 2+ votes to pass).

  Usage
    $ rover <command> [options]

  Commands
    scan <path>           Run AI agents to scan a codebase and create issue tickets
    fix <id>...           Auto-fix issues using Claude with iterative code review
    review                List completed fixes and create pull requests
    consolidate [path]    Find and merge duplicate/related issues using AI
    plan [path]           Generate prioritized work plan with dependency graph
    agents                List all available scanning agents with descriptions
    issues                List, view, copy, or remove stored issue tickets
    remember <text>       Store context in memory to help agents ignore known issues

  SCANNING
    The scan command runs one or more AI agents against your codebase. Each agent
    specializes in detecting specific types of issues (security, performance,
    React anti-patterns, etc.). Issues found are validated by voter agents before
    being saved as tickets.

    Options:
      --all             Run ALL 33 agents (recommended for thorough analysis)
      --agent, -a       Run a specific agent by ID (default: security-auditor)
      --concurrency     Agents to run in parallel with --all (default: 8)
      --dry-run         Preview what would be scanned without running
      --verbose         Show detailed output during scan

    Examples:
      $ rover scan ./my-project                 # Scan with default agent
      $ rover scan ./my-project --all           # Full scan with all 33 agents
      $ rover scan . -a dead-code-detector      # Run specific agent on cwd
      $ rover scan ./app --all --concurrency=2  # Slower but uses less resources

    Batch runs with --all can be resumed if interrupted. If a previous run was
    incomplete, rover will prompt to resume or start fresh.

  FIXING ISSUES
    The fix command creates isolated git worktrees and uses Claude to automatically
    fix issues. Each fix goes through iterative code review until clean.

    Workflow:
      1. Creates a git worktree with branch fix/ISSUE-XXX
      2. Claude analyzes the issue and implements a fix
      3. Claude commits the changes
      4. A code review is run on the changes
      5. If review finds issues, Claude addresses them
      6. Steps 3-5 repeat until review passes (or max iterations hit)
      7. Worktree is left in place for you to create a PR

    Options:
      --concurrency         Issues to fix in parallel (default: 8)
      --max-iterations      Max review cycles per issue (default: 10)
      --verbose             Stream all Claude output for debugging

    Examples:
      $ rover fix ISSUE-001                    # Fix a single issue
      $ rover fix ISSUE-001 ISSUE-002          # Fix multiple issues in parallel
      $ rover fix ISSUE-001 --max-iterations=3 # Limit review iterations
      $ rover fix ISSUE-001 --verbose          # See all Claude output

    After fixing, use "rover review" to list fixes and create pull requests.

  REVIEWING FIXES
    The review command shows all completed fixes and helps create pull requests.
    Fixes are tracked in .rover/fix-state.json with their worktree locations.

    Subcommands:
      review list              List all fixes with their status
      review submit <id>       Create a PR for a specific fix
      review submit --all      Create PRs for all ready fixes
      review clean <id>        Remove a fix worktree and its record
      review clean --all       Remove all fix worktrees and records

    Options:
      --all                 Submit PRs / clean all fixes
      --draft               Create draft PRs instead of regular PRs

    Examples:
      $ rover review list                    # See all completed fixes
      $ rover review submit ISSUE-001        # Create PR for one fix
      $ rover review submit --all            # Create PRs for all ready fixes
      $ rover review submit ISSUE-001 --draft # Create a draft PR
      $ rover review clean ISSUE-001         # Remove worktree after merge
      $ rover review clean --all             # Remove all worktrees and records

  MANAGING ISSUES
    Issues are stored in .rover/tickets/ as Markdown files (ISSUE-001.md, etc.).
    Each ticket includes: title, severity, description, affected files with line
    numbers, and suggested fixes.

    Subcommands:
      issues                  List all issues (shows ID, severity, title)
      issues view <id>        Print full issue content to stdout
      issues copy <id>        Copy issue content to clipboard (macOS)
      issues remove <id>...   Delete issues by ID (removes ticket and history)
      issues ignore <id>...   Mark issues as "won't fix" (hides but prevents re-detection)

    Options:
      --severity, -s    Filter by severity: low, medium, high, critical
                        Can be comma-separated: --severity high,critical
      --all             Include ignored ("won't fix") issues in the list

    Examples:
      $ rover issues                            # List all issues
      $ rover issues --severity critical        # Show only critical issues
      $ rover issues --all                      # Include ignored issues
      $ rover issues view ISSUE-042             # View issue details
      $ rover issues copy ISSUE-042             # Copy to clipboard for sharing
      $ rover issues remove ISSUE-001 ISSUE-002 # Remove resolved issues
      $ rover issues ignore ISSUE-003           # Mark as "won't fix"

  CONSOLIDATION
    The consolidate command analyzes existing issues and merges duplicates or
    closely related issues into single comprehensive tickets. Uses AI to
    intelligently combine descriptions, recommendations, and context.

    Options:
      --dry-run             Preview what would be consolidated without making changes
      --concurrency         Clusters to process in parallel (default: 8)

    Examples:
      $ rover consolidate                    # Consolidate in current directory
      $ rover consolidate ./my-project       # Consolidate in specific path
      $ rover consolidate --dry-run          # Preview consolidation
      $ rover consolidate --concurrency=2    # Process 2 clusters at a time

  PLANNING
    The plan command selects the top 10 highest priority issues and analyzes
    their dependencies to create a work plan. Outputs a Mermaid diagram showing
    which issues can be worked on in parallel and which have dependencies.

    The plan is saved to .rover/plans/ as a markdown file with:
    - Priority issue table
    - Dependency analysis summary
    - Mermaid flowchart diagram
    - Recommended execution order
    - Parallel workstream assignments

    Examples:
      $ rover plan                           # Plan for current directory
      $ rover plan ./my-project              # Plan for specific path

  MEMORY
    The remember command adds entries to .rover/memory.md. Memory is included in
    agent prompts to provide context about intentional decisions, known issues,
    or patterns that should not be flagged. Use this to reduce false positives.

    Examples:
      $ rover remember "Using 'any' type in api-client.ts is intentional for dynamic responses"
      $ rover remember "Large bundle size in analytics.ts is acceptable - vendor SDK"
      $ rover remember "Duplicate code in adapters/ is intentional for isolation"

  AGENTS
    Rover includes 33 specialized scanning agents organized by category:

    Architecture (5):    depth-gauge, generalizer, cohesion-analyzer,
                         layer-petrifier, boilerplate-buster
    Code Clarity (4):    obviousness-auditor, why-asker, naming-renovator,
                         interface-documenter
    Consistency (1):     consistency-cop
    Bug Detection (2):   exception-auditor, logic-detective
    Config (1):          config-cleaner
    Performance (2):     query-optimizer, async-efficiency-auditor
    Dependencies (1):    dependency-auditor
    Code Health (3):     dead-code-detector, complexity-analyzer, duplication-finder
    API (1):             api-contract-validator
    Security (1):        security-auditor
    TypeScript (1):      typescript-quality-auditor
    React (1):           react-patterns-auditor
    Next.js (10):        client-boundary-optimizer, server-action-auditor,
                         data-fetching-strategist, route-segment-analyzer,
                         nextjs-asset-optimizer, nextjs-rendering-optimizer,
                         hydration-mismatch-detector, navigation-pattern-enforcer,
                         metadata-checker, bundle-performance-auditor

    Run "rover agents" to see full descriptions of each agent.

  OUTPUT FILES
    .rover/tickets/         Individual issue Markdown files (ISSUE-XXX.md)
    .rover/issues.json      Issue history for deduplication across runs
    .rover/memory.md        User-provided context for agents
    .rover/run-state.json   Tracks batch run progress for resume capability
    .rover/fix-state.json   Tracks fix workflow state and PR status
    .rover/plans/           Work plans with Mermaid dependency diagrams
`, {
    importMeta: import.meta,
    flags: {
        all: {
            type: 'boolean',
            default: false
        },
        agent: {
            type: 'string',
            shortFlag: 'a'
        },
        concurrency: {
            type: 'number',
            default: 8
        },
        dryRun: {
            type: 'boolean',
            default: false
        },
        verbose: {
            type: 'boolean',
            default: false
        },
        severity: {
            type: 'string',
            shortFlag: 's'
        },
        maxIterations: {
            type: 'number',
            default: 10
        },
        draft: {
            type: 'boolean',
            default: false
        }
    }
});
const [command, targetPath] = cli.input;
// Handle 'remember' command
if (command === 'remember') {
    const description = cli.input.slice(1).join(' ');
    const rememberTargetPath = process.cwd();
    if (!description.trim()) {
        console.error('Error: Please provide a description of what to remember.');
        console.error('Usage: rover remember "description of issue to ignore"');
        process.exit(1);
    }
    (async () => {
        try {
            await appendMemory(rememberTargetPath, description);
            console.log('Added to memory:', description);
            console.log('Location: .rover/memory.md');
        }
        catch (err) {
            console.error(`Error: ${err instanceof Error ? err.message : err}`);
            process.exit(1);
        }
    })();
}
// Handle 'consolidate' command
if (command === 'consolidate') {
    const consolidateTargetPath = targetPath ?? process.cwd();
    render(_jsx(ConsolidateApp, { targetPath: consolidateTargetPath, flags: {
            dryRun: cli.flags.dryRun,
            verbose: cli.flags.verbose,
            concurrency: cli.flags.concurrency
        } }));
}
// Handle 'plan' command
if (command === 'plan') {
    const planTargetPath = targetPath ?? process.cwd();
    const resolvedPlanPath = resolve(planTargetPath);
    (async () => {
        try {
            console.log('\nRover - Work Planning');
            console.log('=====================\n');
            // Load issues
            console.log('Loading issues from .rover/issues.json...');
            const store = await loadIssueStore(resolvedPlanPath);
            // Filter out ignored issues
            const activeIssues = store.issues.filter(i => i.status !== 'wont_fix');
            const ignoredCount = store.issues.length - activeIssues.length;
            if (activeIssues.length === 0) {
                console.error('No issues found. Run "rover scan" first.');
                process.exit(1);
            }
            console.log(`Found ${activeIssues.length} issues total.${ignoredCount > 0 ? ` (${ignoredCount} ignored)` : ''}\n`);
            // Select top priority
            const topIssues = selectTopPriorityIssues(activeIssues, 10);
            console.log(`Selecting top ${topIssues.length} priority issues:`);
            topIssues.forEach((issue, i) => {
                const ticketId = extractTicketId(issue.ticketPath) ?? issue.id;
                console.log(`  ${i + 1}. [${issue.severity.toUpperCase()}] ${ticketId}: ${issue.title}`);
            });
            console.log('\nAnalyzing dependencies with AI...');
            // Run planner
            const result = await runPlanner({
                targetPath: resolvedPlanPath,
                issues: topIssues,
                onProgress: (msg) => console.log(`  ${msg}`)
            });
            // Generate and save plan
            const plan = buildWorkPlan(topIssues, result.analysis);
            const outputPath = await savePlan(resolvedPlanPath, plan);
            console.log(`\nPlan generated successfully!`);
            console.log(`Output: ${outputPath}\n`);
            // Summary
            console.log('Summary:');
            console.log(`  - ${result.analysis.parallelGroups.length} parallel workstream(s) identified`);
            console.log(`  - ${result.analysis.dependencies.length} dependency/conflict(s) found`);
            console.log(`  - Duration: ${(result.durationMs / 1000).toFixed(1)}s`);
            // Print runnable commands
            const executionOrder = result.analysis.executionOrder.filter(Boolean);
            if (executionOrder.length > 0) {
                console.log('\nCommands (in dependency order):');
                console.log('--------------------------------');
                for (const issueId of executionOrder) {
                    console.log(`rover fix ${issueId}`);
                }
                console.log('');
                console.log('Or run all at once:');
                console.log(`rover fix ${executionOrder.join(' ')}`);
                console.log('');
                console.log('See the generated plan file for detailed dependency explanations.');
            }
            process.exit(0);
        }
        catch (err) {
            console.error(`Error: ${err instanceof Error ? err.message : err}`);
            process.exit(1);
        }
    })();
}
// Handle 'fix' command
if (command === 'fix') {
    const issueIds = cli.input.slice(1);
    if (issueIds.length === 0) {
        console.error('Error: Please provide at least one issue ID to fix.');
        console.error('Usage: rover fix ISSUE-001 [ISSUE-002 ...]');
        process.exit(1);
    }
    // Validate issue ID format
    const invalidIds = issueIds.filter(id => !/^ISSUE-\d+$/i.test(id));
    if (invalidIds.length > 0) {
        console.error(`Error: Invalid issue ID format: ${invalidIds.join(', ')}`);
        console.error('Expected format: ISSUE-XXX (e.g., ISSUE-001, ISSUE-042)');
        process.exit(1);
    }
    render(_jsx(FixApp, { targetPath: process.cwd(), issueIds: issueIds.map(id => id.toUpperCase()), flags: {
            concurrency: cli.flags.concurrency,
            maxIterations: cli.flags.maxIterations,
            verbose: cli.flags.verbose
        } }));
}
// Handle 'review' command
if (command === 'review') {
    const subcommand = cli.input[1];
    const issueId = cli.input[2]?.toUpperCase();
    // Default to 'list' if no subcommand
    const effectiveSubcommand = subcommand ?? 'list';
    if (!['list', 'submit', 'clean'].includes(effectiveSubcommand)) {
        console.error(`Error: Unknown subcommand '${subcommand}'`);
        console.error('Usage: rover review [list|submit|clean] [ISSUE-ID]');
        process.exit(1);
    }
    // Validate issue ID format if provided
    if (issueId && !/^ISSUE-\d+$/i.test(issueId)) {
        console.error(`Error: Invalid issue ID format: ${issueId}`);
        console.error('Expected format: ISSUE-XXX (e.g., ISSUE-001, ISSUE-042)');
        process.exit(1);
    }
    // Clean requires an issue ID OR --all flag
    if (effectiveSubcommand === 'clean' && !issueId && !cli.flags.all) {
        console.error('Error: Issue ID or --all flag required for clean command');
        console.error('Usage: rover review clean ISSUE-XXX');
        console.error('       rover review clean --all');
        process.exit(1);
    }
    render(_jsx(ReviewApp, { targetPath: process.cwd(), subcommand: effectiveSubcommand, issueId: issueId, flags: {
            draft: cli.flags.draft,
            all: cli.flags.all,
        } }));
}
// Handle 'agents' command separately
if (command === 'agents') {
    const agents = getAllAgents();
    console.log(`\nAvailable Agents (${agents.length} total):\n`);
    for (const agent of agents) {
        console.log(`  ${agent.id}`);
        console.log(`    ${agent.name}`);
        console.log(`    ${agent.description}\n`);
    }
    process.exit(0);
}
// Handle 'issues' command
if (command === 'issues') {
    const subcommand = cli.input[1];
    // Handle 'issues remove' subcommand
    if (subcommand === 'remove') {
        const ticketIds = cli.input.slice(2);
        const issuesTargetPath = process.cwd();
        if (ticketIds.length === 0) {
            console.error('Error: Please provide at least one ticket ID to remove.');
            console.error('Usage: rover issues remove ISSUE-001 [ISSUE-002 ...]');
            process.exit(1);
        }
        // Validate ticket ID format
        const invalidIds = ticketIds.filter(id => !/^ISSUE-\d+$/i.test(id));
        if (invalidIds.length > 0) {
            console.error(`Error: Invalid ticket ID format: ${invalidIds.join(', ')}`);
            console.error('Expected format: ISSUE-XXX (e.g., ISSUE-001, ISSUE-042)');
            process.exit(1);
        }
        // Perform removal (async IIFE to properly await)
        (async () => {
            try {
                const result = await removeIssues(issuesTargetPath, ticketIds);
                if (result.removed.length > 0) {
                    console.log(`Removed ${result.removed.length} issue(s): ${result.removed.join(', ')}`);
                }
                if (result.notFound.length > 0) {
                    console.warn(`Not found: ${result.notFound.join(', ')}`);
                }
                if (result.errors.length > 0) {
                    for (const { ticketId, error } of result.errors) {
                        console.error(`Error removing ${ticketId}: ${error}`);
                    }
                    process.exit(1);
                }
                process.exit(result.notFound.length > 0 && result.removed.length === 0 ? 1 : 0);
            }
            catch (err) {
                console.error(`Error: ${err instanceof Error ? err.message : err}`);
                process.exit(1);
            }
        })();
    }
    else if (subcommand === 'ignore') {
        // Handle 'issues ignore' subcommand
        const ticketIds = cli.input.slice(2);
        const issuesTargetPath = process.cwd();
        if (ticketIds.length === 0) {
            console.error('Error: Please provide at least one ticket ID to ignore.');
            console.error('Usage: rover issues ignore ISSUE-001 [ISSUE-002 ...]');
            process.exit(1);
        }
        // Validate ticket ID format
        const invalidIds = ticketIds.filter(id => !/^ISSUE-\d+$/i.test(id));
        if (invalidIds.length > 0) {
            console.error(`Error: Invalid ticket ID format: ${invalidIds.join(', ')}`);
            console.error('Expected format: ISSUE-XXX (e.g., ISSUE-001, ISSUE-042)');
            process.exit(1);
        }
        // Perform ignore (async IIFE to properly await)
        (async () => {
            try {
                const result = await ignoreIssues(issuesTargetPath, ticketIds);
                if (result.ignored.length > 0) {
                    console.log(`Ignored ${result.ignored.length} issue(s): ${result.ignored.join(', ')}`);
                    console.log('These issues will be hidden from "rover issues" but won\'t be re-detected.');
                    console.log('Use "rover issues --all" to see ignored issues.');
                }
                if (result.notFound.length > 0) {
                    console.warn(`Not found: ${result.notFound.join(', ')}`);
                }
                if (result.errors.length > 0) {
                    for (const { ticketId, error } of result.errors) {
                        console.error(`Error ignoring ${ticketId}: ${error}`);
                    }
                    process.exit(1);
                }
                process.exit(result.notFound.length > 0 && result.ignored.length === 0 ? 1 : 0);
            }
            catch (err) {
                console.error(`Error: ${err instanceof Error ? err.message : err}`);
                process.exit(1);
            }
        })();
    }
    else if (subcommand === 'view') {
        // Handle 'issues view' subcommand
        const ticketId = cli.input[2];
        const issuesTargetPath = process.cwd();
        if (!ticketId) {
            console.error('Error: Please provide a ticket ID to view.');
            console.error('Usage: rover issues view ISSUE-001');
            process.exit(1);
        }
        // Validate ticket ID format
        if (!/^ISSUE-\d+$/i.test(ticketId)) {
            console.error(`Error: Invalid ticket ID format: ${ticketId}`);
            console.error('Expected format: ISSUE-XXX (e.g., ISSUE-001, ISSUE-042)');
            process.exit(1);
        }
        (async () => {
            try {
                const ticketPath = getTicketPathById(issuesTargetPath, ticketId);
                if (!ticketPath) {
                    console.error(`Error: Issue ${ticketId.toUpperCase()} not found.`);
                    process.exit(1);
                }
                const content = await readFile(ticketPath, 'utf-8');
                console.log(content);
                process.exit(0);
            }
            catch (err) {
                console.error(`Error: ${err instanceof Error ? err.message : err}`);
                process.exit(1);
            }
        })();
    }
    else if (subcommand === 'copy') {
        // Handle 'issues copy' subcommand
        const ticketId = cli.input[2];
        const issuesTargetPath = process.cwd();
        if (!ticketId) {
            console.error('Error: Please provide a ticket ID to copy.');
            console.error('Usage: rover issues copy ISSUE-001');
            process.exit(1);
        }
        // Validate ticket ID format
        if (!/^ISSUE-\d+$/i.test(ticketId)) {
            console.error(`Error: Invalid ticket ID format: ${ticketId}`);
            console.error('Expected format: ISSUE-XXX (e.g., ISSUE-001, ISSUE-042)');
            process.exit(1);
        }
        (async () => {
            try {
                const ticketPath = getTicketPathById(issuesTargetPath, ticketId);
                if (!ticketPath) {
                    console.error(`Error: Issue ${ticketId.toUpperCase()} not found.`);
                    process.exit(1);
                }
                const content = await readFile(ticketPath, 'utf-8');
                execSync('pbcopy', { input: content });
                console.log(`Copied ${ticketId.toUpperCase()} to clipboard.`);
                process.exit(0);
            }
            catch (err) {
                console.error(`Error: ${err instanceof Error ? err.message : err}`);
                process.exit(1);
            }
        })();
    }
    else {
        // List issues (default behavior)
        const issuesTargetPath = targetPath ?? process.cwd();
        const severityFilter = cli.flags.severity
            ? cli.flags.severity.split(',').map(s => s.trim().toLowerCase())
            : undefined;
        // Validate severity values
        const validSeverities = ['low', 'medium', 'high', 'critical'];
        if (severityFilter) {
            const invalidSeverities = severityFilter.filter(s => !validSeverities.includes(s));
            if (invalidSeverities.length > 0) {
                console.error(`Error: Invalid severity level(s): ${invalidSeverities.join(', ')}`);
                console.error(`Valid severities: ${validSeverities.join(', ')}`);
                process.exit(1);
            }
        }
        render(_jsx(IssuesList, { targetPath: issuesTargetPath, severityFilter: severityFilter, showIgnored: cli.flags.all }));
    }
    // Don't fall through to other command handlers
    // The async IIFE or render will handle exit
}
// Handle missing command
if (!command) {
    cli.showHelp();
    process.exit(0);
}
else if (command === 'issues') {
    // Already handled above, async IIFE is running
}
else if (command === 'remember') {
    // Already handled above, async IIFE is running
}
else if (command === 'consolidate') {
    // Already handled above, React component is rendering
}
else if (command === 'plan') {
    // Already handled above, async IIFE is running
}
else if (command === 'fix') {
    // Already handled above, React component is rendering
}
else if (command === 'review') {
    // Already handled above, React component is rendering
}
else if (command === 'scan') {
    if (!targetPath) {
        console.error('Error: Please provide a target path to scan.');
        console.error('Usage: rover scan <path>');
        process.exit(1);
    }
    // Validate agent if provided (and not using --all)
    if (cli.flags.agent && !cli.flags.all) {
        const validAgents = getAgentIds();
        if (!validAgents.includes(cli.flags.agent)) {
            console.error(`Error: Unknown agent "${cli.flags.agent}"`);
            console.error(`Available agents: ${validAgents.join(', ')}`);
            process.exit(1);
        }
    }
    // Use BatchApp for --all, App for single agent
    if (cli.flags.all) {
        // Check for incomplete run state and prompt for resume
        (async () => {
            const resolvedPath = resolve(targetPath);
            let shouldResume = false;
            try {
                const existingState = await loadRunState(resolvedPath);
                if (existingState && isRunIncomplete(existingState)) {
                    const completedCount = existingState.agents.filter(a => a.status === 'completed').length;
                    const totalCount = existingState.agents.length;
                    if (existingState.isStale) {
                        console.log(`Found stale incomplete run (${completedCount}/${totalCount} agents, started ${existingState.startedAt})`);
                        console.log('Starting fresh run...\n');
                        await clearRunState(resolvedPath);
                    }
                    else {
                        console.log(`Found incomplete batch run: ${completedCount}/${totalCount} agents completed`);
                        shouldResume = await promptYesNo('Resume previous run? (y/n): ');
                        if (!shouldResume) {
                            console.log('Starting fresh run...\n');
                            await clearRunState(resolvedPath);
                        }
                        else {
                            console.log('Resuming...\n');
                        }
                    }
                }
            }
            catch (err) {
                // If there's an error loading state, just start fresh
                console.error(`Warning: Could not check for previous run state: ${err instanceof Error ? err.message : err}`);
            }
            render(_jsx(BatchApp, { targetPath: targetPath, flags: {
                    all: true,
                    concurrency: cli.flags.concurrency,
                    dryRun: cli.flags.dryRun,
                    resume: shouldResume
                } }));
        })();
    }
    else {
        render(_jsx(App, { command: command, targetPath: targetPath, flags: {
                agent: cli.flags.agent,
                dryRun: cli.flags.dryRun,
                verbose: cli.flags.verbose
            } }));
    }
}
else {
    // Unknown command
    console.error(`Unknown command: ${command}`);
    cli.showHelp();
    process.exit(1);
}
