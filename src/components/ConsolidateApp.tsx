import React, { useState, useEffect, useRef } from 'react';
import { Box, Text, useApp } from 'ink';
import Spinner from 'ink-spinner';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { loadIssueStore, consolidateIssues } from '../storage/issues.js';
import { createConsolidatedTicketFile, deleteTicketFile, extractTicketId } from '../storage/tickets.js';
import { clusterIssues, getClusterStats } from '../agents/cluster.js';
import { runConsolidator, type ConsolidatorResult } from '../agents/consolidator.js';
import type { IssueCluster } from '../types/index.js';

interface ConsolidateAppProps {
  targetPath: string;
  flags: {
    dryRun: boolean;
    verbose?: boolean;
    concurrency?: number;
  };
}

interface ClusterStatus {
  clusterId: string;
  reason: string;
  issueCount: number;
  status: 'pending' | 'processing' | 'complete' | 'error';
  newTicketId?: string;
  error?: string;
}

interface ConsolidationSummary {
  clustersProcessed: number;
  issuesConsolidated: number;
  newTicketsCreated: string[];
  originalTicketsRemoved: string[];
  totalDurationMs: number;
}

interface ClusterResult {
  cluster: IssueCluster;
  result?: ConsolidatorResult;
  error?: string;
}

const DEFAULT_CONCURRENCY = 4;

export function ConsolidateApp({ targetPath, flags }: ConsolidateAppProps) {
  const { exit } = useApp();
  const resolvedPath = targetPath ? resolve(targetPath) : process.cwd();
  const concurrency = flags.concurrency ?? DEFAULT_CONCURRENCY;

  const [phase, setPhase] = useState<'init' | 'loading' | 'clustering' | 'consolidating' | 'applying' | 'complete' | 'error'>('init');
  const [error, setError] = useState<string | null>(null);
  const [totalIssues, setTotalIssues] = useState(0);
  const [clusterStatuses, setClusterStatuses] = useState<ClusterStatus[]>([]);
  const [currentMessages, setCurrentMessages] = useState<Map<string, string>>(new Map());
  const [result, setResult] = useState<ConsolidationSummary | null>(null);

  // Track active workers
  const activeWorkersRef = useRef(0);

  useEffect(() => {
    async function runConsolidation() {
      // Validation
      if (!existsSync(resolvedPath)) {
        setError(`Target path does not exist: ${resolvedPath}`);
        setPhase('error');
        return;
      }

      setPhase('loading');

      try {
        // Load issues
        const store = await loadIssueStore(resolvedPath);

        // Filter out ignored issues
        const activeIssues = store.issues.filter(i => i.status !== 'wont_fix');
        setTotalIssues(activeIssues.length);

        if (activeIssues.length === 0) {
          setError('No issues found. Run "rover scan" first.');
          setPhase('error');
          return;
        }

        if (activeIssues.length === 1) {
          setError('Only 1 issue found. Need at least 2 issues to consolidate.');
          setPhase('error');
          return;
        }

        setPhase('clustering');

        // Cluster issues
        const issueClusters = clusterIssues(activeIssues);

        if (issueClusters.length === 0) {
          setResult({
            clustersProcessed: 0,
            issuesConsolidated: 0,
            newTicketsCreated: [],
            originalTicketsRemoved: [],
            totalDurationMs: 0
          });
          setPhase('complete');
          return;
        }

        const stats = getClusterStats(issueClusters);

        if (flags.dryRun) {
          console.log(`\nDry run - would consolidate ${stats.totalIssuesInClusters} issues into ${stats.totalClusters} clusters:`);
          for (const cluster of issueClusters) {
            console.log(`  - ${cluster.reason}: ${cluster.issues.map(i => extractTicketId(i.ticketPath) ?? i.id).join(', ')}`);
          }
          exit();
          return;
        }

        // Initialize cluster statuses
        setClusterStatuses(issueClusters.map(cluster => ({
          clusterId: cluster.id,
          reason: cluster.reason,
          issueCount: cluster.issues.length,
          status: 'pending'
        })));

        setPhase('consolidating');

        // Process clusters in parallel using work queue pattern
        const clusterResults: ClusterResult[] = [];
        const workQueue = [...issueClusters];
        let totalDurationMs = 0;

        // Worker function
        async function processWorker(): Promise<void> {
          while (workQueue.length > 0) {
            const cluster = workQueue.shift();
            if (!cluster) break;

            activeWorkersRef.current++;

            // Update status to processing
            setClusterStatuses(prev => prev.map(s =>
              s.clusterId === cluster.id
                ? { ...s, status: 'processing' as const }
                : s
            ));

            try {
              const consolidatorResult = await runConsolidator({
                targetPath: resolvedPath,
                cluster,
                onProgress: (message) => {
                  setCurrentMessages(prev => {
                    const next = new Map(prev);
                    next.set(cluster.id, message);
                    return next;
                  });
                }
              });

              clusterResults.push({ cluster, result: consolidatorResult });
              totalDurationMs += consolidatorResult.durationMs;

              // Update status to complete (file changes applied later)
              setClusterStatuses(prev => prev.map(s =>
                s.clusterId === cluster.id
                  ? { ...s, status: 'complete' as const }
                  : s
              ));

            } catch (err) {
              const errorMessage = err instanceof Error ? err.message : 'Unknown error';
              clusterResults.push({ cluster, error: errorMessage });

              setClusterStatuses(prev => prev.map(s =>
                s.clusterId === cluster.id
                  ? { ...s, status: 'error' as const, error: errorMessage }
                  : s
              ));
            } finally {
              activeWorkersRef.current--;
              // Clear message for this cluster
              setCurrentMessages(prev => {
                const next = new Map(prev);
                next.delete(cluster.id);
                return next;
              });
            }
          }
        }

        // Start workers
        const workers: Promise<void>[] = [];
        for (let i = 0; i < Math.min(concurrency, issueClusters.length); i++) {
          workers.push(processWorker());
        }

        // Wait for all workers to complete
        await Promise.all(workers);

        // Phase 2: Apply file changes sequentially to avoid race conditions
        setPhase('applying');

        const consolidationSummary: ConsolidationSummary = {
          clustersProcessed: 0,
          issuesConsolidated: 0,
          newTicketsCreated: [],
          originalTicketsRemoved: [],
          totalDurationMs
        };

        // Process successful results
        for (const { cluster, result: consolidatorResult, error: clusterError } of clusterResults) {
          if (clusterError || !consolidatorResult) continue;

          try {
            // Delete original tickets
            for (const originalId of consolidatorResult.originalIssueIds) {
              await deleteTicketFile(resolvedPath, originalId);
              consolidationSummary.originalTicketsRemoved.push(originalId);
            }

            // Create consolidated ticket
            const ticketResult = await createConsolidatedTicketFile(
              resolvedPath,
              consolidatorResult.consolidatedIssue,
              consolidatorResult.originalIssueIds
            );

            // Update issue store
            await consolidateIssues(
              resolvedPath,
              consolidatorResult.originalIssueIds,
              ticketResult.issue
            );

            const newTicketId = extractTicketId(ticketResult.path) ?? 'unknown';

            // Update status with new ticket ID
            setClusterStatuses(prev => prev.map(s =>
              s.clusterId === cluster.id
                ? { ...s, newTicketId }
                : s
            ));

            consolidationSummary.clustersProcessed++;
            consolidationSummary.issuesConsolidated += cluster.issues.length;
            consolidationSummary.newTicketsCreated.push(newTicketId);

          } catch (err) {
            const errorMessage = err instanceof Error ? err.message : 'Unknown error';
            setClusterStatuses(prev => prev.map(s =>
              s.clusterId === cluster.id
                ? { ...s, status: 'error' as const, error: `File error: ${errorMessage}` }
                : s
            ));
          }
        }

        setResult(consolidationSummary);
        setPhase('complete');

      } catch (err) {
        setError(err instanceof Error ? err.message : 'Unknown error');
        setPhase('error');
      }
    }

    runConsolidation();
  }, [resolvedPath, flags.dryRun, concurrency, exit]);

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

  if (phase === 'init' || phase === 'loading') {
    return (
      <Box marginY={1}>
        <Text color="cyan"><Spinner type="dots" /></Text>
        <Text> Loading issues...</Text>
      </Box>
    );
  }

  if (phase === 'clustering') {
    return (
      <Box flexDirection="column" marginY={1}>
        <Box gap={1}>
          <Text color="cyan"><Spinner type="dots" /></Text>
          <Text>Analyzing {totalIssues} issues for duplicates...</Text>
        </Box>
      </Box>
    );
  }

  if (phase === 'applying') {
    return (
      <Box flexDirection="column" marginY={1}>
        <Box gap={1}>
          <Text color="cyan"><Spinner type="dots" /></Text>
          <Text>Applying file changes...</Text>
        </Box>
      </Box>
    );
  }

  const completedClusters = clusterStatuses.filter(s => s.status === 'complete').length;
  const processingClusters = clusterStatuses.filter(s => s.status === 'processing');

  return (
    <Box flexDirection="column">
      {/* Header */}
      <Box borderStyle="round" borderColor="cyan" padding={1} marginBottom={1}>
        <Text color="cyan" bold>ROVER</Text>
        <Text> - Issue Consolidation</Text>
        {concurrency > 1 && <Text dimColor> ({concurrency} parallel)</Text>}
      </Box>

      {/* Progress */}
      {phase === 'consolidating' && (
        <Box flexDirection="column" marginBottom={1}>
          <Box marginBottom={1}>
            <Text>Progress: </Text>
            <Text color="green" bold>{completedClusters}</Text>
            <Text>/{clusterStatuses.length} clusters processed</Text>
          </Box>

          {/* Currently processing clusters */}
          {processingClusters.length > 0 && (
            <Box flexDirection="column" paddingLeft={2}>
              {processingClusters.map(cluster => (
                <Box key={cluster.clusterId} flexDirection="column">
                  <Box gap={1}>
                    <Text color="cyan"><Spinner type="dots" /></Text>
                    <Text>{cluster.reason}</Text>
                    <Text dimColor>({cluster.issueCount} issues)</Text>
                  </Box>
                  {currentMessages.get(cluster.clusterId) && (
                    <Box paddingLeft={3}>
                      <Text dimColor>{currentMessages.get(cluster.clusterId)}</Text>
                    </Box>
                  )}
                </Box>
              ))}
            </Box>
          )}

          {/* Completed clusters */}
          {completedClusters > 0 && (
            <Box flexDirection="column" marginTop={1}>
              <Text bold dimColor>Completed:</Text>
              <Box flexDirection="column" paddingLeft={2}>
                {clusterStatuses.filter(s => s.status === 'complete').map(cluster => (
                  <Box key={cluster.clusterId} gap={1}>
                    <Text color="green">✓</Text>
                    <Text>{cluster.reason}</Text>
                    <Text dimColor>({cluster.issueCount} issues)</Text>
                  </Box>
                ))}
              </Box>
            </Box>
          )}
        </Box>
      )}

      {/* Results */}
      {phase === 'complete' && result && (
        <Box flexDirection="column">
          <Box borderStyle="double" borderColor="green" padding={1} marginBottom={1}>
            <Text color="green" bold>Consolidation Complete</Text>
          </Box>

          {result.clustersProcessed === 0 ? (
            <Box flexDirection="column">
              <Text color="green">No duplicate issues found!</Text>
              <Text dimColor>All {totalIssues} issues are unique.</Text>
            </Box>
          ) : (
            <Box flexDirection="column">
              {/* Summary stats */}
              <Box flexDirection="column" marginBottom={1}>
                <Box gap={2}>
                  <Box>
                    <Text dimColor>Duration: </Text>
                    <Text>{(result.totalDurationMs / 1000).toFixed(1)}s</Text>
                  </Box>
                </Box>

                <Box gap={2}>
                  <Box>
                    <Text dimColor>Clusters processed: </Text>
                    <Text>{result.clustersProcessed}</Text>
                  </Box>
                  <Box>
                    <Text dimColor>Issues consolidated: </Text>
                    <Text color="yellow">{result.issuesConsolidated}</Text>
                    <Text> → </Text>
                    <Text color="green" bold>{result.newTicketsCreated.length}</Text>
                  </Box>
                </Box>
              </Box>

              {/* New tickets */}
              <Box flexDirection="column">
                <Text bold>New Consolidated Tickets:</Text>
                <Box flexDirection="column" paddingLeft={2} marginTop={1}>
                  {clusterStatuses.filter(s => s.status === 'complete' && s.newTicketId).map(cluster => (
                    <Box key={cluster.clusterId} gap={1}>
                      <Text color="cyan">{cluster.newTicketId}</Text>
                      <Text dimColor>← {cluster.reason}</Text>
                    </Box>
                  ))}
                </Box>
              </Box>

              {/* Removed tickets */}
              {result.originalTicketsRemoved.length > 0 && (
                <Box marginTop={1}>
                  <Text dimColor>Removed original tickets: </Text>
                  <Text dimColor>{result.originalTicketsRemoved.join(', ')}</Text>
                </Box>
              )}
            </Box>
          )}

          {/* Location */}
          {result.newTicketsCreated.length > 0 && (
            <Box marginTop={1}>
              <Text dimColor>Updated tickets at: </Text>
              <Text color="blue">{resolvedPath}/.rover/tickets/</Text>
            </Box>
          )}
        </Box>
      )}
    </Box>
  );
}
