import React, { useState, useEffect, useRef } from 'react';
import { Box, Text, useApp } from 'ink';
import Spinner from 'ink-spinner';
import { resolve } from 'node:path';
import { runBatchFix } from '../fix/index.js';
import type { BatchFixProgress, BatchFixResult, BatchIssueResult } from '../fix/types.js';
import { throttle } from '../utils/throttle.js';

interface BatchFixAppProps {
  targetPath: string;
  issueIds: string[];
  flags: {
    maxIterations: number;
    verbose: boolean;
  };
}

type Phase = 'worktree' | 'fixing' | 'reviewing' | 'complete' | 'error';

function getPhaseIcon(phase: Phase): string {
  switch (phase) {
    case 'worktree':
    case 'fixing':
    case 'reviewing':
      return '●';
    case 'complete':
      return '✓';
    case 'error':
      return '✗';
  }
}

function getPhaseColor(phase: Phase): string {
  switch (phase) {
    case 'worktree':
    case 'fixing':
    case 'reviewing':
      return 'cyan';
    case 'complete':
      return 'green';
    case 'error':
      return 'red';
  }
}

export function BatchFixApp({ targetPath, issueIds, flags }: BatchFixAppProps) {
  const { exit } = useApp();
  const resolvedPath = resolve(targetPath);

  const [phase, setPhase] = useState<'init' | 'running' | 'complete' | 'error'>('init');
  const [error, setError] = useState<string | null>(null);
  const [currentProgress, setCurrentProgress] = useState<BatchFixProgress | null>(null);
  const [result, setResult] = useState<BatchFixResult | null>(null);

  // Throttled progress update
  const throttledUpdateProgress = useRef(
    throttle((progress: BatchFixProgress) => {
      setCurrentProgress(progress);
    }, 100)
  ).current;

  useEffect(() => {
    async function runBatchFixWorkflow() {
      setPhase('running');

      try {
        const batchResult = await runBatchFix(
          {
            targetPath: resolvedPath,
            issueIds,
            maxIterations: flags.maxIterations,
            verbose: flags.verbose,
          },
          (progress) => {
            throttledUpdateProgress(progress);
          }
        );

        setResult(batchResult);
        setPhase('complete');
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Unknown error');
        setPhase('error');
      }
    }

    runBatchFixWorkflow().catch((err) => {
      setError(err instanceof Error ? err.message : 'Unknown error');
      setPhase('error');
    });
  }, [resolvedPath, issueIds, flags.maxIterations, flags.verbose, throttledUpdateProgress]);

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
        <Text dimColor>Initializing batch fix workflow...</Text>
      </Box>
    );
  }

  return (
    <Box flexDirection="column">
      {/* Header */}
      <Box borderStyle="round" borderColor="cyan" padding={1} marginBottom={1}>
        <Text color="cyan" bold>
          ROVER
        </Text>
        <Text> - Batch Fix ({issueIds.length} issue{issueIds.length !== 1 ? 's' : ''} in single branch)</Text>
      </Box>

      {/* Progress */}
      {phase === 'running' && currentProgress && (
        <Box flexDirection="column" marginBottom={1}>
          <Box marginBottom={1} gap={1}>
            <Text color="cyan">
              <Spinner type="dots" />
            </Text>
            <Text bold>
              {currentProgress.phase === 'worktree' && 'Creating worktree...'}
              {currentProgress.phase === 'fixing' && `Fixing issues (${currentProgress.currentIssueIndex ?? 0}/${currentProgress.totalIssues})...`}
              {currentProgress.phase === 'reviewing' && `Reviewing (iteration ${currentProgress.iteration ?? 1})...`}
            </Text>
          </Box>
          <Box paddingLeft={2}>
            <Text dimColor>{currentProgress.message}</Text>
          </Box>
        </Box>
      )}

      {/* Results */}
      {phase === 'complete' && result && (
        <Box flexDirection="column">
          <Box borderStyle="double" borderColor={result.status === 'error' ? 'red' : 'green'} padding={1} marginBottom={1}>
            <Text color={result.status === 'error' ? 'red' : 'green'} bold>
              Batch Fix {result.status === 'error' ? 'Failed' : 'Complete'}
            </Text>
          </Box>

          {/* Summary stats */}
          <Box flexDirection="column" marginBottom={1}>
            <Box gap={2}>
              <Box>
                <Text dimColor>Total issues: </Text>
                <Text>{issueIds.length}</Text>
              </Box>
              <Box>
                <Text dimColor>Fixed: </Text>
                <Text color="green" bold>
                  {result.successCount}
                </Text>
              </Box>
              {result.failedCount > 0 && (
                <Box>
                  <Text dimColor>Skipped/Failed: </Text>
                  <Text color="yellow">{result.failedCount}</Text>
                </Box>
              )}
              <Box>
                <Text dimColor>Iterations: </Text>
                <Text>{result.iterations}</Text>
              </Box>
            </Box>
          </Box>

          {/* Branch info */}
          {result.branchName && (
            <Box flexDirection="column" marginBottom={1}>
              <Box>
                <Text dimColor>Branch: </Text>
                <Text color="cyan">{result.branchName}</Text>
              </Box>
              {result.worktreePath && (
                <Box>
                  <Text dimColor>Worktree: </Text>
                  <Text color="blue">{result.worktreePath}</Text>
                </Box>
              )}
            </Box>
          )}

          {/* Per-issue results */}
          <Box flexDirection="column">
            <Text bold>Issue Results:</Text>
            <Box flexDirection="column" paddingLeft={2} marginTop={1}>
              {result.issueResults.map((issueResult: BatchIssueResult) => {
                const color = issueResult.status === 'success'
                  ? 'green'
                  : issueResult.status === 'skipped'
                    ? 'blue'
                    : 'red';
                const icon = issueResult.status === 'success'
                  ? '✓'
                  : issueResult.status === 'skipped'
                    ? '○'
                    : '✗';

                return (
                  <Box key={issueResult.issueId} gap={1}>
                    <Text color={color}>{icon}</Text>
                    <Text bold>[{issueResult.issueId}]</Text>
                    <Text dimColor>
                      {issueResult.status === 'success'
                        ? 'Fixed'
                        : issueResult.error ?? issueResult.status}
                    </Text>
                  </Box>
                );
              })}
            </Box>
          </Box>

          {/* Next steps */}
          {result.successCount > 0 && result.status !== 'error' && (
            <Box marginTop={1} flexDirection="column">
              <Text bold>Next steps:</Text>
              <Box paddingLeft={2} flexDirection="column">
                <Text dimColor>1. Review the changes in the worktree</Text>
                <Text dimColor>2. Create a pull request: rover review submit {result.issueResults[0]?.issueId}</Text>
                <Text dimColor>   (All {result.successCount} fixes will be included in one PR)</Text>
              </Box>
            </Box>
          )}

          {result.error && (
            <Box marginTop={1}>
              <Text color="red">Error: {result.error}</Text>
            </Box>
          )}
        </Box>
      )}
    </Box>
  );
}
