#!/usr/bin/env node
import React from 'react';
import { render } from 'ink';
import meow from 'meow';
import { App } from './components/App.js';
import { BatchApp } from './components/BatchApp.js';
import { IssuesList } from './components/IssuesList.js';
import { getAgentIds, getAllAgents } from './agents/index.js';
import { removeIssues } from './storage/issues.js';

const cli = meow(`
  Usage
    $ rover <command> [options]

  Commands
    scan <path>           Scan a codebase for issues
    agents                List available scanning agents
    issues                List stored issues with filtering
    issues remove <ids>   Remove issues by ticket ID

  Options
    --all           Run ALL agents (4 in parallel by default)
    --agent, -a     Run a specific agent (default: critical-path-scout)
    --concurrency   Max agents to run in parallel (default: 4)
    --dry-run       Show what would be scanned without running
    --verbose       Enable verbose output
    --severity, -s  Filter issues by severity (e.g., high or high,critical)
    --help          Show this help message
    --version       Show version number

  Examples
    $ rover scan ./my-project                    # Run default agent
    $ rover scan ./my-project --all              # Run ALL 17 agents
    $ rover scan ./my-project --agent=security-sweeper
    $ rover scan ./my-project --all --concurrency=2
    $ rover agents
    $ rover issues                               # List all stored issues
    $ rover issues --severity high,critical      # Filter by severity
    $ rover issues remove ISSUE-001              # Remove a single issue
    $ rover issues remove ISSUE-001 ISSUE-002    # Remove multiple issues

  Output
    Issues are saved to .rover/tickets/ as individual Markdown files.
    Issue history is stored in .rover/issues.json for deduplication.
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
      default: 4
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
    }
  }
});

const [command, targetPath] = cli.input;

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
      } catch (err) {
        console.error(`Error: ${err instanceof Error ? err.message : err}`);
        process.exit(1);
      }
    })();
  } else {
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

    render(
      <IssuesList
        targetPath={issuesTargetPath}
        severityFilter={severityFilter}
      />
    );
  }
  // Don't fall through to other command handlers
  // The async IIFE or render will handle exit
}

// Handle missing command
if (!command) {
  cli.showHelp();
  process.exit(0);
} else if (command === 'issues') {
  // Already handled above, async IIFE is running
} else if (command === 'scan') {
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
    render(
      <BatchApp
        targetPath={targetPath}
        flags={{
          all: true,
          concurrency: cli.flags.concurrency,
          dryRun: cli.flags.dryRun
        }}
      />
    );
  } else {
    render(
      <App
        command={command}
        targetPath={targetPath}
        flags={{
          agent: cli.flags.agent,
          dryRun: cli.flags.dryRun,
          verbose: cli.flags.verbose
        }}
      />
    );
  }
} else {
  // Unknown command
  console.error(`Unknown command: ${command}`);
  cli.showHelp();
  process.exit(1);
}
