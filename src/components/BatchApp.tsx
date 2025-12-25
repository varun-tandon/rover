import React, { useState, useEffect, useRef } from 'react';
import { Box, Text, useApp } from 'ink';
import Spinner from 'ink-spinner';
import { runAgentsBatched, getAgentIds, getAgent } from '../agents/index.js';
import type { BatchProgress, AgentResult, BatchRunResult } from '../agents/index.js';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { throttle } from '../utils/throttle.js';
import {
  loadRunState,
  saveRunState,
  clearRunState,
  createRunState,
  getCompletedAgentIds,
  updateAgentStatus,
  markRunComplete,
  type BatchRunState,
  type AgentResultSummary
} from '../storage/run-state.js';

interface BatchAppProps {
  targetPath: string;
  flags: {
    all?: boolean;
    agent?: string;
    concurrency?: number;
    dryRun: boolean;
    resume?: boolean;
  };
}

interface AgentStatus {
  agentId: string;
  agentName: string;
  status: 'pending' | 'running' | 'complete' | 'error';
  candidateIssues: number;
  approvedIssues: number;
}

export function BatchApp({ targetPath, flags }: BatchAppProps) {
  const { exit } = useApp();
  const resolvedPath = targetPath ? resolve(targetPath) : process.cwd();

  const [phase, setPhase] = useState<'init' | 'running' | 'complete' | 'error'>('init');
  const [error, setError] = useState<string | null>(null);
  const [currentProgress, setCurrentProgress] = useState<BatchProgress | null>(null);
  const [agentStatuses, setAgentStatuses] = useState<AgentStatus[]>([]);
  const [result, setResult] = useState<BatchRunResult | null>(null);
  const [skippedCount, setSkippedCount] = useState(0);

  // Throttled progress update - 150ms (faster than single-agent 200ms) because batch mode
  // has less frequent updates per agent and users benefit from snappier feedback during
  // the longer overall batch execution time.
  const throttledSetProgress = useRef(
    throttle((progress: BatchProgress) => setCurrentProgress(progress), 150)
  ).current;

  // Ref to hold mutable run state (avoids stale closures in callbacks)
  const runStateRef = useRef<BatchRunState | null>(null);

  useEffect(() => {
    async function runBatchScan() {
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

      // Load or create run state
      const agentIds = getAgentIds();
      let skipAgentIds: string[] = [];

      if (flags.resume) {
        const existingState = await loadRunState(resolvedPath);
        if (existingState && existingState.completedAt === null) {
          // Resume from existing state
          runStateRef.current = existingState;
          skipAgentIds = getCompletedAgentIds(existingState);
          setSkippedCount(skipAgentIds.length);
        } else {
          // No valid state to resume, create fresh
          runStateRef.current = createRunState(
            resolvedPath,
            agentIds,
            flags.concurrency ?? 4,
            (id) => getAgent(id)?.name ?? id
          );
        }
      } else {
        // Fresh run - clear any existing state
        await clearRunState(resolvedPath);
        runStateRef.current = createRunState(
          resolvedPath,
          agentIds,
          flags.concurrency ?? 4,
          (id) => getAgent(id)?.name ?? id
        );
      }

      // Save initial state
      await saveRunState(resolvedPath, runStateRef.current);

      // Initialize agent statuses (mark skipped ones as complete)
      const skipSet = new Set(skipAgentIds);
      setAgentStatuses(agentIds.map(id => {
        const existingAgent = runStateRef.current?.agents.find(a => a.agentId === id);
        return {
          agentId: id,
          agentName: existingAgent?.agentName ?? getAgent(id)?.name ?? id,
          status: skipSet.has(id) ? 'complete' : 'pending',
          candidateIssues: existingAgent?.result?.candidateIssues ?? 0,
          approvedIssues: existingAgent?.result?.approvedIssues ?? 0
        };
      }));

      setPhase('running');

      try {
        const batchResult = await runAgentsBatched(resolvedPath, 'all', {
          concurrency: flags.concurrency ?? 4,
          skipAgentIds,
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
                    status: agentResult.error ? 'error' : 'complete' as const,
                    agentName: agentResult.agentName,
                    candidateIssues: agentResult.scanResult.issues.length,
                    approvedIssues: agentResult.arbitratorResult.approvedIssues.length
                  }
                : s
            ));
          },
          onStateChange: async (agentId, status, agentResult) => {
            if (!runStateRef.current) return;

            // Build result summary if agent completed successfully
            let resultSummary: AgentResultSummary | undefined;
            if (status === 'completed' && agentResult && !agentResult.error) {
              resultSummary = {
                candidateIssues: agentResult.scanResult.issues.length,
                approvedIssues: agentResult.arbitratorResult.approvedIssues.length,
                rejectedIssues: agentResult.arbitratorResult.rejectedIssues.length,
                ticketsCreated: agentResult.arbitratorResult.ticketsCreated.length,
                costUsd: agentResult.scanResult.costUsd
              };
            }

            // Update state
            runStateRef.current = updateAgentStatus(
              runStateRef.current,
              agentId,
              status,
              {
                error: agentResult?.error,
                result: resultSummary,
                agentName: agentResult?.agentName
              }
            );

            // Persist to disk
            await saveRunState(resolvedPath, runStateRef.current);
          }
        });

        // Mark run as complete
        if (runStateRef.current) {
          runStateRef.current = markRunComplete(runStateRef.current);
          await saveRunState(resolvedPath, runStateRef.current);
        }

        setResult(batchResult);
        setPhase('complete');
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Unknown error');
        setPhase('error');
      }
    }

    runBatchScan();
  }, [resolvedPath, flags.dryRun, flags.concurrency, flags.resume, throttledSetProgress, exit]);

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
            {skippedCount > 0 && (
              <Text dimColor> ({skippedCount} resumed)</Text>
            )}
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
                {result.skippedAgents > 0 && (
                  <Text dimColor> (+{result.skippedAgents} resumed)</Text>
                )}
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
                .filter(agentResult => agentResult.scanResult.issues.length > 0 || agentResult.arbitratorResult.approvedIssues.length > 0)
                .map(agentResult => (
                  <Box key={agentResult.agentId} gap={1}>
                    <Text color={agentResult.arbitratorResult.approvedIssues.length > 0 ? 'yellow' : 'gray'}>
                      {agentResult.arbitratorResult.approvedIssues.length > 0 ? '!' : '·'}
                    </Text>
                    <Text>{agentResult.agentName}:</Text>
                    <Text dimColor>
                      {agentResult.scanResult.issues.length} found,{' '}
                      <Text color="green">{agentResult.arbitratorResult.approvedIssues.length} approved</Text>
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
