import React, { useState, useEffect, useRef } from 'react';
import { Box, Text, useApp } from 'ink';
import Spinner from 'ink-spinner';
import { runAgentsBatched, getAgentIds } from '../agents/index.js';
import type { BatchProgress, AgentResult, BatchRunResult } from '../agents/index.js';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';

interface BatchAppProps {
  targetPath: string;
  flags: {
    all?: boolean;
    agent?: string;
    concurrency?: number;
    dryRun: boolean;
  };
}

interface AgentStatus {
  agentId: string;
  agentName: string;
  status: 'pending' | 'running' | 'complete' | 'error';
  candidateIssues: number;
  approvedIssues: number;
}

// Throttle function
function throttle<T extends (...args: Parameters<T>) => void>(fn: T, delay: number): T {
  let lastCall = 0;
  return ((...args: Parameters<T>) => {
    const now = Date.now();
    if (now - lastCall >= delay) {
      lastCall = now;
      fn(...args);
    }
  }) as T;
}

export function BatchApp({ targetPath, flags }: BatchAppProps) {
  const { exit } = useApp();
  const resolvedPath = targetPath ? resolve(targetPath) : process.cwd();

  const [phase, setPhase] = useState<'init' | 'running' | 'complete' | 'error'>('init');
  const [error, setError] = useState<string | null>(null);
  const [currentProgress, setCurrentProgress] = useState<BatchProgress | null>(null);
  const [agentStatuses, setAgentStatuses] = useState<AgentStatus[]>([]);
  const [result, setResult] = useState<BatchRunResult | null>(null);

  // Throttled progress update
  const throttledSetProgress = useRef(
    throttle((progress: BatchProgress) => setCurrentProgress(progress), 150)
  ).current;

  useEffect(() => {
    async function run() {
      // Validation
      if (!existsSync(resolvedPath)) {
        setError(`Target path does not exist: ${resolvedPath}`);
        setPhase('error');
        return;
      }

      if (flags.dryRun) {
        const agentIds = getAgentIds();
        console.log(`Would run ${agentIds.length} agents on ${resolvedPath}`);
        console.log(`Agents: ${agentIds.join(', ')}`);
        exit();
        return;
      }

      // Initialize agent statuses
      const agentIds = getAgentIds();
      setAgentStatuses(agentIds.map(id => ({
        agentId: id,
        agentName: id,
        status: 'pending',
        candidateIssues: 0,
        approvedIssues: 0
      })));

      setPhase('running');

      try {
        const batchResult = await runAgentsBatched(resolvedPath, 'all', {
          concurrency: flags.concurrency ?? 4,
          onProgress: (progress) => {
            throttledSetProgress(progress);
            // Update agent status to running
            setAgentStatuses(prev => prev.map(s =>
              s.agentId === progress.agentId
                ? { ...s, status: 'running' as const, agentName: progress.agentName }
                : s
            ));
          },
          onAgentComplete: (agentResult) => {
            setAgentStatuses(prev => prev.map(s =>
              s.agentId === agentResult.agentId
                ? {
                    ...s,
                    status: 'complete' as const,
                    agentName: agentResult.agentName,
                    candidateIssues: agentResult.scanResult.issues.length,
                    approvedIssues: agentResult.arbitratorResult.approvedIssues.length
                  }
                : s
            ));
          }
        });

        setResult(batchResult);
        setPhase('complete');
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Unknown error');
        setPhase('error');
      }
    }

    run();
  }, [resolvedPath, flags.dryRun, flags.concurrency, throttledSetProgress, exit]);

  // Auto-exit
  useEffect(() => {
    if (phase === 'complete' || phase === 'error') {
      const timer = setTimeout(() => exit(), 100);
      return () => clearTimeout(timer);
    }
  }, [phase, exit]);

  if (phase === 'error') {
    return (
      <Box flexDirection="column" marginY={1}>
        <Text color="red" bold>Error: {error}</Text>
      </Box>
    );
  }

  if (phase === 'init') {
    return (
      <Box marginY={1}>
        <Text dimColor>Initializing batch scan...</Text>
      </Box>
    );
  }

  const completedAgents = agentStatuses.filter(s => s.status === 'complete').length;
  const runningAgents = agentStatuses.filter(s => s.status === 'running');

  return (
    <Box flexDirection="column">
      {/* Header */}
      <Box borderStyle="round" borderColor="cyan" padding={1} marginBottom={1}>
        <Text color="cyan" bold>ROVER</Text>
        <Text> - Batch Scan ({agentStatuses.length} agents)</Text>
      </Box>

      {/* Progress */}
      {phase === 'running' && (
        <Box flexDirection="column" marginBottom={1}>
          <Box marginBottom={1}>
            <Text>Progress: </Text>
            <Text color="green" bold>{completedAgents}</Text>
            <Text>/{agentStatuses.length} agents complete</Text>
          </Box>

          {/* Currently running agents */}
          {runningAgents.length > 0 && (
            <Box flexDirection="column" paddingLeft={2}>
              {runningAgents.map(agent => (
                <Box key={agent.agentId} gap={1}>
                  <Text color="cyan"><Spinner type="dots" /></Text>
                  <Text>{agent.agentName}</Text>
                </Box>
              ))}
            </Box>
          )}

          {/* Current message */}
          {currentProgress && (
            <Box marginTop={1}>
              <Text dimColor>{currentProgress.message}</Text>
            </Box>
          )}
        </Box>
      )}

      {/* Results */}
      {phase === 'complete' && result && (
        <Box flexDirection="column">
          <Box borderStyle="double" borderColor="green" padding={1} marginBottom={1}>
            <Text color="green" bold>Batch Scan Complete</Text>
          </Box>

          {/* Summary stats */}
          <Box flexDirection="column" marginBottom={1}>
            <Box gap={2}>
              <Box>
                <Text dimColor>Duration: </Text>
                <Text>{(result.totalDurationMs / 1000).toFixed(1)}s</Text>
              </Box>
              <Box>
                <Text dimColor>Cost: </Text>
                <Text>${result.totalCostUsd.toFixed(4)}</Text>
              </Box>
            </Box>

            <Box gap={2}>
              <Box>
                <Text dimColor>Agents run: </Text>
                <Text>{result.agentResults.length}</Text>
              </Box>
              <Box>
                <Text dimColor>Candidates: </Text>
                <Text color="yellow">{result.totalCandidateIssues}</Text>
              </Box>
              <Box>
                <Text dimColor>Approved: </Text>
                <Text color="green" bold>{result.totalApprovedIssues}</Text>
              </Box>
              <Box>
                <Text dimColor>Rejected: </Text>
                <Text color="red">{result.totalRejectedIssues}</Text>
              </Box>
            </Box>

            <Box>
              <Text dimColor>Tickets created: </Text>
              <Text color="cyan" bold>{result.totalTickets}</Text>
            </Box>
          </Box>

          {/* Per-agent breakdown */}
          <Box flexDirection="column">
            <Text bold>Results by Agent:</Text>
            <Box flexDirection="column" paddingLeft={2} marginTop={1}>
              {result.agentResults
                .filter(r => r.scanResult.issues.length > 0 || r.arbitratorResult.approvedIssues.length > 0)
                .map(r => (
                  <Box key={r.agentId} gap={1}>
                    <Text color={r.arbitratorResult.approvedIssues.length > 0 ? 'yellow' : 'gray'}>
                      {r.arbitratorResult.approvedIssues.length > 0 ? '!' : '·'}
                    </Text>
                    <Text>{r.agentName}:</Text>
                    <Text dimColor>
                      {r.scanResult.issues.length} found,{' '}
                      <Text color="green">{r.arbitratorResult.approvedIssues.length} approved</Text>
                    </Text>
                  </Box>
                ))}
            </Box>

            {result.totalApprovedIssues === 0 && (
              <Box marginTop={1}>
                <Text color="green">No issues found across all agents!</Text>
              </Box>
            )}
          </Box>

          {/* Ticket location */}
          {result.totalTickets > 0 && (
            <Box marginTop={1}>
              <Text dimColor>Tickets saved to: </Text>
              <Text color="blue">{resolvedPath}/.rover/tickets/</Text>
            </Box>
          )}
        </Box>
      )}
    </Box>
  );
}
