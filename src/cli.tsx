#!/usr/bin/env node
import React from 'react';
import { render } from 'ink';
import meow from 'meow';
import { App } from './components/App.js';
import { BatchApp } from './components/BatchApp.js';
import { getAgentIds, getAllAgents } from './agents/index.js';

const cli = meow(`
  Usage
    $ rover <command> [options]

  Commands
    scan <path>     Scan a codebase for issues
    agents          List available scanning agents

  Options
    --all           Run ALL agents (4 in parallel by default)
    --agent, -a     Run a specific agent (default: critical-path-scout)
    --concurrency   Max agents to run in parallel (default: 4)
    --dry-run       Show what would be scanned without running
    --verbose       Enable verbose output
    --help          Show this help message
    --version       Show version number

  Examples
    $ rover scan ./my-project                    # Run default agent
    $ rover scan ./my-project --all              # Run ALL 17 agents
    $ rover scan ./my-project --agent=security-sweeper
    $ rover scan ./my-project --all --concurrency=2
    $ rover agents

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

// Handle missing command
if (!command) {
  cli.showHelp();
  process.exit(0);
}

// Handle scan command
if (command === 'scan') {
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
