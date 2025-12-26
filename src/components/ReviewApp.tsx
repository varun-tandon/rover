import React, { useState, useEffect } from 'react';
import { Box, Text, useApp } from 'ink';
import Spinner from 'ink-spinner';
import { resolve } from 'node:path';
import {
  listFixes,
  createPR,
  createAllPRs,
  cleanupFix,
  cleanupAllFixes,
  type PRCreateResult,
  type CleanupResult,
} from '../fix/review-manager.js';
import type { FixRecord } from '../storage/fix-state.js';

type ReviewSubcommand = 'list' | 'submit' | 'clean';

interface ReviewAppProps {
  targetPath: string;
  subcommand: ReviewSubcommand;
  issueId?: string;
  flags: {
    draft?: boolean;
    all?: boolean;
  };
}

function getStatusIcon(status: FixRecord['status']): string {
  switch (status) {
    case 'in_progress':
      return '●';
    case 'ready_for_review':
      return '○';
    case 'pr_created':
      return '✓';
    case 'merged':
      return '✓';
    case 'error':
      return '✗';
  }
}

function getStatusColor(status: FixRecord['status']): string {
  switch (status) {
    case 'in_progress':
      return 'cyan';
    case 'ready_for_review':
      return 'yellow';
    case 'pr_created':
      return 'green';
    case 'merged':
      return 'blue';
    case 'error':
      return 'red';
  }
}

function getStatusLabel(status: FixRecord['status']): string {
  switch (status) {
    case 'in_progress':
      return 'In Progress';
    case 'ready_for_review':
      return 'Ready for PR';
    case 'pr_created':
      return 'PR Created';
    case 'merged':
      return 'Merged';
    case 'error':
      return 'Error';
  }
}

function ReviewList({ targetPath }: { targetPath: string }) {
  const { exit } = useApp();
  const [loading, setLoading] = useState(true);
  const [fixes, setFixes] = useState<FixRecord[]>([]);
  const [stats, setStats] = useState({ ready: 0, prCreated: 0, error: 0 });

  useEffect(() => {
    async function load() {
      const result = await listFixes(targetPath);
      setFixes(result.fixes);
      setStats({
        ready: result.readyCount,
        prCreated: result.prCreatedCount,
        error: result.errorCount,
      });
      setLoading(false);
    }
    load().catch(() => setLoading(false));
  }, [targetPath]);

  useEffect(() => {
    if (!loading) {
      const timer = setTimeout(() => exit(), 100);
      return () => clearTimeout(timer);
    }
  }, [loading, exit]);

  if (loading) {
    return (
      <Box marginY={1}>
        <Text color="cyan">
          <Spinner type="dots" />
        </Text>
        <Text> Loading fixes...</Text>
      </Box>
    );
  }

  if (fixes.length === 0) {
    return (
      <Box flexDirection="column" marginY={1}>
        <Text dimColor>No fixes found.</Text>
        <Text dimColor>Run `rover fix ISSUE-XXX` to create fixes.</Text>
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
        <Text> - Review Fixes ({fixes.length} total)</Text>
      </Box>

      {/* Stats */}
      <Box gap={2} marginBottom={1}>
        <Box>
          <Text dimColor>Ready: </Text>
          <Text color="yellow" bold>{stats.ready}</Text>
        </Box>
        <Box>
          <Text dimColor>PR Created: </Text>
          <Text color="green" bold>{stats.prCreated}</Text>
        </Box>
        {stats.error > 0 && (
          <Box>
            <Text dimColor>Errors: </Text>
            <Text color="red" bold>{stats.error}</Text>
          </Box>
        )}
      </Box>

      {/* Fix list */}
      <Box flexDirection="column" paddingLeft={2}>
        {fixes.map((fix) => (
          <Box key={fix.issueId} flexDirection="column" marginBottom={1}>
            <Box gap={1}>
              <Text color={getStatusColor(fix.status)}>
                {getStatusIcon(fix.status)}
              </Text>
              <Text bold>[{fix.issueId}]</Text>
              <Text color={getStatusColor(fix.status)}>
                {getStatusLabel(fix.status)}
              </Text>
            </Box>
            <Box paddingLeft={4}>
              <Text dimColor>Branch: </Text>
              <Text color="cyan">{fix.branchName}</Text>
            </Box>
            {fix.prUrl && (
              <Box paddingLeft={4}>
                <Text dimColor>PR: </Text>
                <Text color="blue">{fix.prUrl}</Text>
              </Box>
            )}
            <Box paddingLeft={4}>
              <Text dimColor>Worktree: </Text>
              <Text>{fix.worktreePath}</Text>
            </Box>
          </Box>
        ))}
      </Box>

      {/* Help */}
      {stats.ready > 0 && (
        <Box marginTop={1} flexDirection="column">
          <Text bold>Next steps:</Text>
          <Box paddingLeft={2} flexDirection="column">
            <Text dimColor>rover review submit ISSUE-XXX  - Create PR for a specific fix</Text>
            <Text dimColor>rover review submit --all      - Create PRs for all ready fixes</Text>
            <Text dimColor>rover review clean ISSUE-XXX   - Remove a fix worktree</Text>
          </Box>
        </Box>
      )}
    </Box>
  );
}

function ReviewSubmit({
  targetPath,
  issueId,
  all,
  draft,
}: {
  targetPath: string;
  issueId?: string;
  all?: boolean;
  draft?: boolean;
}) {
  const { exit } = useApp();
  const [phase, setPhase] = useState<'working' | 'done' | 'error'>('working');
  const [currentIssue, setCurrentIssue] = useState<string | null>(null);
  const [statusMessage, setStatusMessage] = useState<string>('');
  const [results, setResults] = useState<PRCreateResult[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    async function submit() {
      if (all) {
        // Create PRs for all ready fixes
        const allResults = await createAllPRs(targetPath, {
          draft,
          onProgress: (id, result) => {
            setCurrentIssue(id);
            setResults((prev) => [...prev, result]);
          },
          onLog: (msg) => setStatusMessage(msg),
        });
        setResults(allResults);
        setPhase('done');
      } else if (issueId) {
        // Create PR for specific fix
        setCurrentIssue(issueId);
        const result = await createPR(targetPath, issueId, {
          draft,
          onLog: (msg) => setStatusMessage(msg),
        });
        setResults([result]);
        setPhase(result.success ? 'done' : 'error');
        if (!result.success) {
          setError(result.error ?? 'Unknown error');
        }
      } else {
        setError('No issue ID specified. Use --all or provide an issue ID.');
        setPhase('error');
      }
    }
    submit().catch((err) => {
      setError(err instanceof Error ? err.message : 'Unknown error');
      setPhase('error');
    });
  }, [targetPath, issueId, all, draft]);

  useEffect(() => {
    if (phase === 'done' || phase === 'error') {
      const timer = setTimeout(() => exit(), 100);
      return () => clearTimeout(timer);
    }
  }, [phase, exit]);

  if (phase === 'working') {
    return (
      <Box marginY={1} flexDirection="column">
        <Box>
          <Text color="cyan">
            <Spinner type="dots" />
          </Text>
          <Text> Creating PR{all ? 's' : ''}{currentIssue ? ` for ${currentIssue}` : ''}...</Text>
        </Box>
        {statusMessage && (
          <Box paddingLeft={2}>
            <Text dimColor>→ {statusMessage}</Text>
          </Box>
        )}
      </Box>
    );
  }

  if (phase === 'error') {
    return (
      <Box flexDirection="column" marginY={1}>
        <Text color="red" bold>
          Error: {error}
        </Text>
      </Box>
    );
  }

  const successCount = results.filter((r) => r.success && !r.error?.includes('already exists')).length;
  const existingCount = results.filter((r) => r.error?.includes('already exists')).length;
  const failedCount = results.filter((r) => !r.success).length;

  return (
    <Box flexDirection="column">
      {/* Header */}
      <Box borderStyle="double" borderColor="green" padding={1} marginBottom={1}>
        <Text color="green" bold>
          PR Creation Complete
        </Text>
      </Box>

      {/* Stats */}
      <Box gap={2} marginBottom={1}>
        <Box>
          <Text dimColor>Created: </Text>
          <Text color="green" bold>{successCount}</Text>
        </Box>
        {existingCount > 0 && (
          <Box>
            <Text dimColor>Already existed: </Text>
            <Text color="blue">{existingCount}</Text>
          </Box>
        )}
        {failedCount > 0 && (
          <Box>
            <Text dimColor>Failed: </Text>
            <Text color="red">{failedCount}</Text>
          </Box>
        )}
      </Box>

      {/* Results */}
      <Box flexDirection="column" paddingLeft={2}>
        {results.map((result) => (
          <Box key={result.issueId} flexDirection="column" marginBottom={1}>
            <Box gap={1}>
              <Text color={result.success ? 'green' : 'red'}>
                {result.success ? '✓' : '✗'}
              </Text>
              <Text bold>[{result.issueId}]</Text>
              {result.prUrl && (
                <Text color="blue">{result.prUrl}</Text>
              )}
              {result.error && !result.prUrl && (
                <Text color="red">{result.error}</Text>
              )}
            </Box>
          </Box>
        ))}
      </Box>
    </Box>
  );
}

function ReviewClean({
  targetPath,
  issueId,
}: {
  targetPath: string;
  issueId: string;
}) {
  const { exit } = useApp();
  const [phase, setPhase] = useState<'working' | 'done' | 'error'>('working');
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    async function clean() {
      const result = await cleanupFix(targetPath, issueId);
      if (result.success) {
        setPhase('done');
      } else {
        setError(result.error ?? 'Unknown error');
        setPhase('error');
      }
    }
    clean().catch((err) => {
      setError(err instanceof Error ? err.message : 'Unknown error');
      setPhase('error');
    });
  }, [targetPath, issueId]);

  useEffect(() => {
    if (phase === 'done' || phase === 'error') {
      const timer = setTimeout(() => exit(), 100);
      return () => clearTimeout(timer);
    }
  }, [phase, exit]);

  if (phase === 'working') {
    return (
      <Box marginY={1}>
        <Text color="cyan">
          <Spinner type="dots" />
        </Text>
        <Text> Cleaning up {issueId}...</Text>
      </Box>
    );
  }

  if (phase === 'error') {
    return (
      <Box flexDirection="column" marginY={1}>
        <Text color="red" bold>
          Error: {error}
        </Text>
      </Box>
    );
  }

  return (
    <Box flexDirection="column" marginY={1}>
      <Text color="green" bold>
        ✓ Cleaned up {issueId}
      </Text>
      <Text dimColor>Worktree removed and fix record deleted.</Text>
    </Box>
  );
}

function ReviewCleanAll({ targetPath }: { targetPath: string }) {
  const { exit } = useApp();
  const [phase, setPhase] = useState<'working' | 'done' | 'error'>('working');
  const [currentIssue, setCurrentIssue] = useState<string | null>(null);
  const [statusMessage, setStatusMessage] = useState<string>('');
  const [results, setResults] = useState<CleanupResult[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    async function cleanAll() {
      const allResults = await cleanupAllFixes(targetPath, {
        onProgress: (id, result) => {
          setCurrentIssue(id);
          setResults((prev) => [...prev, result]);
        },
        onLog: (msg) => setStatusMessage(msg),
      });
      setResults(allResults);
      if (allResults.length === 0) {
        setError('No fixes to clean');
        setPhase('error');
      } else {
        setPhase('done');
      }
    }
    cleanAll().catch((err) => {
      setError(err instanceof Error ? err.message : 'Unknown error');
      setPhase('error');
    });
  }, [targetPath]);

  useEffect(() => {
    if (phase === 'done' || phase === 'error') {
      const timer = setTimeout(() => exit(), 100);
      return () => clearTimeout(timer);
    }
  }, [phase, exit]);

  if (phase === 'working') {
    return (
      <Box marginY={1} flexDirection="column">
        <Box>
          <Text color="cyan">
            <Spinner type="dots" />
          </Text>
          <Text> Cleaning up all fixes{currentIssue ? ` (${currentIssue})` : ''}...</Text>
        </Box>
        {statusMessage && (
          <Box paddingLeft={2}>
            <Text dimColor>→ {statusMessage}</Text>
          </Box>
        )}
      </Box>
    );
  }

  if (phase === 'error') {
    return (
      <Box flexDirection="column" marginY={1}>
        <Text color="red" bold>
          Error: {error}
        </Text>
      </Box>
    );
  }

  const successCount = results.filter((r) => r.success).length;
  const failedCount = results.filter((r) => !r.success).length;

  return (
    <Box flexDirection="column">
      {/* Header */}
      <Box borderStyle="double" borderColor="green" padding={1} marginBottom={1}>
        <Text color="green" bold>
          Cleanup Complete
        </Text>
      </Box>

      {/* Stats */}
      <Box gap={2} marginBottom={1}>
        <Box>
          <Text dimColor>Cleaned: </Text>
          <Text color="green" bold>{successCount}</Text>
        </Box>
        {failedCount > 0 && (
          <Box>
            <Text dimColor>Failed: </Text>
            <Text color="red">{failedCount}</Text>
          </Box>
        )}
      </Box>

      {/* Results */}
      <Box flexDirection="column" paddingLeft={2}>
        {results.map((result) => (
          <Box key={result.issueId} gap={1}>
            <Text color={result.success ? 'green' : 'red'}>
              {result.success ? '✓' : '✗'}
            </Text>
            <Text bold>[{result.issueId}]</Text>
            {result.error && (
              <Text color="red">{result.error}</Text>
            )}
          </Box>
        ))}
      </Box>
    </Box>
  );
}

export function ReviewApp({ targetPath, subcommand, issueId, flags }: ReviewAppProps) {
  const resolvedPath = resolve(targetPath);

  switch (subcommand) {
    case 'list':
      return <ReviewList targetPath={resolvedPath} />;
    case 'submit':
      return (
        <ReviewSubmit
          targetPath={resolvedPath}
          issueId={issueId}
          all={flags.all}
          draft={flags.draft}
        />
      );
    case 'clean':
      if (flags.all) {
        return <ReviewCleanAll targetPath={resolvedPath} />;
      }
      if (!issueId) {
        return (
          <Box marginY={1}>
            <Text color="red">Error: Issue ID required for clean command</Text>
          </Box>
        );
      }
      return <ReviewClean targetPath={resolvedPath} issueId={issueId} />;
  }
}
