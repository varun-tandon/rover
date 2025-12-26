import React, { useState, useEffect, useRef } from 'react';
import { Box, Text, useApp } from 'ink';
import Spinner from 'ink-spinner';
import { resolve } from 'node:path';
import { runFix } from '../fix/index.js';
import type { FixProgress, FixResult, FixPhase } from '../fix/types.js';
import { throttle } from '../utils/throttle.js';

interface FixAppProps {
  targetPath: string;
  issueIds: string[];
  flags: {
    concurrency: number;
    maxIterations: number;
    verbose: boolean;
  };
}

interface IssueStatus {
  issueId: string;
  phase: FixPhase;
  iteration: number;
  maxIterations: number;
  message: string;
  actionableItems?: number;
  worktreePath?: string;
  branchName?: string;
  error?: string;
}

function getPhaseIcon(phase: FixPhase): string {
  switch (phase) {
    case 'pending':
      return '○';
    case 'worktree':
    case 'fixing':
    case 'reviewing':
    case 'iterating':
      return '●';
    case 'complete':
      return '✓';
    case 'already_fixed':
      return '✓';
    case 'error':
      return '✗';
  }
}

function getPhaseColor(phase: FixPhase): string {
  switch (phase) {
    case 'pending':
      return 'gray';
    case 'worktree':
    case 'fixing':
    case 'reviewing':
    case 'iterating':
      return 'cyan';
    case 'complete':
      return 'green';
    case 'already_fixed':
      return 'blue';
    case 'error':
      return 'red';
  }
}

export function FixApp({ targetPath, issueIds, flags }: FixAppProps) {
  const { exit } = useApp();
  const resolvedPath = resolve(targetPath);

  const [phase, setPhase] = useState<'init' | 'running' | 'complete' | 'error'>('init');
  const [error, setError] = useState<string | null>(null);
  const [issueStatuses, setIssueStatuses] = useState<Map<string, IssueStatus>>(new Map());
  const [results, setResults] = useState<FixResult[]>([]);

  // Throttled progress update
  const throttledUpdateStatus = useRef(
    throttle((progress: FixProgress) => {
      setIssueStatuses((prev) => {
        const next = new Map(prev);
        next.set(progress.issueId, {
          issueId: progress.issueId,
          phase: progress.phase,
          iteration: progress.iteration,
          maxIterations: progress.maxIterations,
          message: progress.message,
          actionableItems: progress.actionableItems,
        });
        return next;
      });
    }, 100)
  ).current;

  useEffect(() => {
    async function runFixWorkflow() {
      // Initialize statuses
      const initialStatuses = new Map<string, IssueStatus>();
      for (const issueId of issueIds) {
        initialStatuses.set(issueId, {
          issueId,
          phase: 'pending',
          iteration: 0,
          maxIterations: flags.maxIterations,
          message: 'Waiting...',
        });
      }
      setIssueStatuses(initialStatuses);
      setPhase('running');

      try {
        const fixResults = await runFix(
          {
            targetPath: resolvedPath,
            issueIds,
            concurrency: flags.concurrency,
            maxIterations: flags.maxIterations,
            verbose: flags.verbose,
          },
          (progress) => {
            throttledUpdateStatus(progress);
          }
        );

        // Update final statuses from results
        setIssueStatuses((prev) => {
          const next = new Map(prev);
          for (const result of fixResults) {
            const existing = next.get(result.issueId);
            const phase = result.status === 'success'
              ? 'complete'
              : result.status === 'already_fixed'
                ? 'already_fixed'
                : result.status === 'error'
                  ? 'error'
                  : 'complete';
            next.set(result.issueId, {
              issueId: result.issueId,
              phase,
              iteration: result.iterations,
              maxIterations: flags.maxIterations,
              message:
                result.status === 'success'
                  ? `Complete after ${result.iterations} iteration(s)`
                  : result.status === 'already_fixed'
                    ? 'Already fixed - issue removed'
                    : result.status === 'iteration_limit'
                      ? `Hit iteration limit (${result.iterations})`
                      : result.error ?? 'Error',
              worktreePath: result.worktreePath,
              branchName: result.branchName,
              error: result.error,
              actionableItems: existing?.actionableItems,
            });
          }
          return next;
        });

        setResults(fixResults);
        setPhase('complete');
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Unknown error');
        setPhase('error');
      }
    }

    runFixWorkflow().catch((err) => {
      setError(err instanceof Error ? err.message : 'Unknown error');
      setPhase('error');
    });
  }, [resolvedPath, issueIds, flags.concurrency, flags.maxIterations, throttledUpdateStatus]);

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
        <Text color="red" bold>
          Error: {error}
        </Text>
      </Box>
    );
  }

  if (phase === 'init') {
    return (
      <Box marginY={1}>
        <Text dimColor>Initializing fix workflow...</Text>
      </Box>
    );
  }

  const statusList = Array.from(issueStatuses.values());
  const completedCount = statusList.filter(
    (s) => s.phase === 'complete' || s.phase === 'already_fixed' || s.phase === 'error'
  ).length;
  const successCount = results.filter((r) => r.status === 'success').length;
  const alreadyFixedCount = results.filter((r) => r.status === 'already_fixed').length;
  const errorCount = results.filter((r) => r.status === 'error').length;
  const iterationLimitCount = results.filter((r) => r.status === 'iteration_limit').length;

  return (
    <Box flexDirection="column">
      {/* Header */}
      <Box borderStyle="round" borderColor="cyan" padding={1} marginBottom={1}>
        <Text color="cyan" bold>
          ROVER
        </Text>
        <Text> - Fix Issues ({issueIds.length} issue{issueIds.length !== 1 ? 's' : ''})</Text>
      </Box>

      {/* Progress */}
      {phase === 'running' && (
        <Box flexDirection="column" marginBottom={1}>
          <Box marginBottom={1}>
            <Text>Progress: </Text>
            <Text color="green" bold>
              {completedCount}
            </Text>
            <Text>/{issueIds.length} issues</Text>
          </Box>

          {/* Issue statuses */}
          <Box flexDirection="column" paddingLeft={2}>
            {statusList.map((status) => (
              <Box key={status.issueId} flexDirection="column" marginBottom={1}>
                <Box gap={1}>
                  {status.phase === 'pending' || status.phase === 'complete' || status.phase === 'error' ? (
                    <Text color={getPhaseColor(status.phase)}>{getPhaseIcon(status.phase)}</Text>
                  ) : (
                    <Text color="cyan">
                      <Spinner type="dots" />
                    </Text>
                  )}
                  <Text bold>[{status.issueId}]</Text>
                  {status.branchName && <Text dimColor>{status.branchName}</Text>}
                </Box>
                <Box paddingLeft={4}>
                  <Text dimColor>{status.message}</Text>
                </Box>
                {status.actionableItems !== undefined && status.actionableItems > 0 && (
                  <Box paddingLeft={4}>
                    <Text color="yellow">
                      {status.actionableItems} actionable item{status.actionableItems !== 1 ? 's' : ''} remaining
                    </Text>
                  </Box>
                )}
              </Box>
            ))}
          </Box>
        </Box>
      )}

      {/* Results */}
      {phase === 'complete' && (
        <Box flexDirection="column">
          <Box borderStyle="double" borderColor="green" padding={1} marginBottom={1}>
            <Text color="green" bold>
              Fix Workflow Complete
            </Text>
          </Box>

          {/* Summary stats */}
          <Box flexDirection="column" marginBottom={1}>
            <Box gap={2}>
              <Box>
                <Text dimColor>Total: </Text>
                <Text>{results.length}</Text>
              </Box>
              <Box>
                <Text dimColor>Success: </Text>
                <Text color="green" bold>
                  {successCount}
                </Text>
              </Box>
              {alreadyFixedCount > 0 && (
                <Box>
                  <Text dimColor>Already fixed: </Text>
                  <Text color="blue">{alreadyFixedCount}</Text>
                </Box>
              )}
              {iterationLimitCount > 0 && (
                <Box>
                  <Text dimColor>Iteration limit: </Text>
                  <Text color="yellow">{iterationLimitCount}</Text>
                </Box>
              )}
              {errorCount > 0 && (
                <Box>
                  <Text dimColor>Errors: </Text>
                  <Text color="red">{errorCount}</Text>
                </Box>
              )}
            </Box>
          </Box>

          {/* Per-issue results */}
          <Box flexDirection="column">
            <Text bold>Results:</Text>
            <Box flexDirection="column" paddingLeft={2} marginTop={1}>
              {results.map((result) => {
                const color = result.status === 'success'
                  ? 'green'
                  : result.status === 'already_fixed'
                    ? 'blue'
                    : result.status === 'error'
                      ? 'red'
                      : 'yellow';
                const icon = result.status === 'success' || result.status === 'already_fixed'
                  ? '✓'
                  : result.status === 'error'
                    ? '✗'
                    : '!';
                const message = result.status === 'success'
                  ? `Fixed in ${result.iterations} iteration(s)`
                  : result.status === 'already_fixed'
                    ? 'Already fixed - issue removed'
                    : result.status === 'iteration_limit'
                      ? `Hit limit after ${result.iterations} iterations`
                      : result.error;

                return (
                  <Box key={result.issueId} flexDirection="column" marginBottom={1}>
                    <Box gap={1}>
                      <Text color={color}>{icon}</Text>
                      <Text bold>[{result.issueId}]</Text>
                      <Text dimColor>{message}</Text>
                    </Box>
                    {result.worktreePath && (
                      <Box paddingLeft={4}>
                        <Text dimColor>Worktree: </Text>
                        <Text color="blue">{result.worktreePath}</Text>
                      </Box>
                    )}
                    {result.branchName && result.status !== 'already_fixed' && (
                      <Box paddingLeft={4}>
                        <Text dimColor>Branch: </Text>
                        <Text color="cyan">{result.branchName}</Text>
                      </Box>
                    )}
                  </Box>
                );
              })}
            </Box>
          </Box>

          {/* Next steps */}
          {successCount > 0 && (
            <Box marginTop={1} flexDirection="column">
              <Text bold>Next steps:</Text>
              <Box paddingLeft={2} flexDirection="column">
                <Text dimColor>1. Review the changes in each worktree</Text>
                <Text dimColor>2. Create pull requests from the fix branches</Text>
                <Text dimColor>3. After merging, remove worktrees with: git worktree remove {'<path>'}</Text>
              </Box>
            </Box>
          )}
        </Box>
      )}
    </Box>
  );
}
