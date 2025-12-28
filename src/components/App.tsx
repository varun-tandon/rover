import React, { useState, useEffect, useRef } from 'react';
import { Box, Text, useApp } from 'ink';
import type { CandidateIssue, ApprovedIssue, CheckerStatus } from '../types/index.js';
import { ScanProgress } from './ScanProgress.js';
import { CheckingProgress } from './CheckingProgress.js';
import { Results } from './Results.js';
import { getAgent, getAgentIds, runScanner, runChecker, runArbitrator } from '../agents/index.js';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { throttle } from '../utils/throttle.js';

type Phase = 'init' | 'scanning' | 'checking' | 'saving' | 'complete' | 'error';

interface AppProps {
  command: string;
  targetPath: string;
  flags: {
    agent?: string;
    dryRun: boolean;
    verbose?: boolean;
  };
}

export function App({ command, targetPath, flags }: AppProps) {
  const { exit } = useApp();

  // State
  const [phase, setPhase] = useState<Phase>('init');
  const [error, setError] = useState<string | null>(null);
  const [scanMessage, setScanMessage] = useState('Initializing...');
  const [candidateIssues, setCandidateIssues] = useState<CandidateIssue[]>([]);
  const [checkerStatus, setCheckerStatus] = useState<CheckerStatus>({
    status: 'pending',
    issuesChecked: 0,
    totalIssues: 0
  });
  const [approvedIssues, setApprovedIssues] = useState<ApprovedIssue[]>([]);
  const [rejectedIssues, setRejectedIssues] = useState<CandidateIssue[]>([]);
  const [ticketPaths, setTicketPaths] = useState<string[]>([]);
  const [totalDuration, setTotalDuration] = useState(0);
  const [totalCost, setTotalCost] = useState(0);
  const [scanCost, setScanCost] = useState(0);

  const agentId = flags.agent ?? 'security-auditor';
  const agent = getAgent(agentId);
  const resolvedPath = targetPath ? resolve(targetPath) : process.cwd();

  // Throttled message setter - 200ms balances UI responsiveness (feels instant to users)
  // with React render performance (avoids excessive re-renders during rapid file scanning)
  const throttledSetScanMessage = useRef(
    throttle((msg: string) => setScanMessage(msg), 200)
  ).current;

  // Throttled cost setter for realtime cost updates
  const throttledSetScanCost = useRef(
    throttle((cost: number) => setScanCost(cost), 200)
  ).current;

  // Ref to track issues checked (needed for batch updates)
  const issuesCheckedRef = useRef(0);

  // Throttled checker progress update - now accepts batch count
  const throttledUpdateCheckerProgress = useRef(
    throttle((batchCount: number) => {
      issuesCheckedRef.current += batchCount;
      setCheckerStatus(prev => ({
        ...prev,
        status: 'checking' as const,
        issuesChecked: issuesCheckedRef.current
      }));
    }, 300)
  ).current;

  // Main scan workflow
  useEffect(() => {
    async function runWorkflow() {
      const startTime = Date.now();
      let cost = 0;

      try {
        // Validation
        if (command !== 'scan') {
          setError(`Unknown command: ${command}. Use 'rover scan <path>'`);
          setPhase('error');
          return;
        }

        if (!agent) {
          const available = getAgentIds().join(', ');
          setError(`Unknown agent: ${agentId}. Available: ${available}`);
          setPhase('error');
          return;
        }

        if (!existsSync(resolvedPath)) {
          setError(`Target path does not exist: ${resolvedPath}`);
          setPhase('error');
          return;
        }

        // Dry run mode
        if (flags.dryRun) {
          setScanMessage(`Would scan ${resolvedPath} with ${agent.name}`);
          setPhase('complete');
          return;
        }

        // Phase 1: Scanning
        setPhase('scanning');
        setScanMessage('Starting scan...');

        const scanResult = await runScanner({
          targetPath: resolvedPath,
          agentId,
          existingIssues: [],
          onProgress: throttledSetScanMessage,
        });

        setCandidateIssues(scanResult.issues);

        // If no issues found, skip to complete
        if (scanResult.issues.length === 0) {
          setTotalDuration(Date.now() - startTime);
          setTotalCost(cost);
          setPhase('complete');
          return;
        }

        // Phase 2: Checking
        setPhase('checking');
        setCheckerStatus({
          status: 'checking',
          issuesChecked: 0,
          totalIssues: scanResult.issues.length
        });

        // Reset issues checked ref before checking
        issuesCheckedRef.current = 0;

        const checkerResult = await runChecker({
          targetPath: resolvedPath,
          agentId,
          issues: scanResult.issues,
          onProgress: (batchCount, completed) => {
            if (completed) {
              throttledUpdateCheckerProgress(batchCount);
            }
          }
        });

        // Mark checker as complete
        setCheckerStatus(prev => ({
          ...prev,
          status: 'completed',
          issuesChecked: prev.totalIssues
        }));

        // Phase 3: Save
        setPhase('saving');

        const arbitratorResult = await runArbitrator({
          targetPath: resolvedPath,
          candidateIssues: scanResult.issues,
          approvedIds: checkerResult.approvedIds
        });

        setApprovedIssues(arbitratorResult.approvedIssues);
        setRejectedIssues(arbitratorResult.rejectedIssues);
        setTicketPaths(arbitratorResult.ticketsCreated);

        // Complete
        setTotalDuration(Date.now() - startTime);
        setTotalCost(cost);
        setPhase('complete');

      } catch (err) {
        setError(err instanceof Error ? err.message : 'Unknown error occurred');
        setPhase('error');
      }
    }

    runWorkflow();
  }, [command, agentId, agent, resolvedPath, flags.dryRun, throttledSetScanMessage, throttledSetScanCost, throttledUpdateCheckerProgress]);

  // Auto-exit after completion
  useEffect(() => {
    if (phase === 'complete' || phase === 'error') {
      const timer = setTimeout(() => {
        exit();
      }, 100);
      return () => clearTimeout(timer);
    }
  }, [phase, exit]);

  // Render based on phase
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
        <Text dimColor>Initializing Rover...</Text>
      </Box>
    );
  }

  return (
    <Box flexDirection="column">
      {/* Header */}
      <Box borderStyle="round" borderColor="cyan" padding={1} marginBottom={1}>
        <Text color="cyan" bold>ROVER</Text>
        <Text> - AI Codebase Scanner</Text>
      </Box>

      {/* Scanning phase */}
      {(phase === 'scanning' || phase === 'checking' || phase === 'saving' || phase === 'complete') && (
        <ScanProgress
          agentName={agent?.name ?? agentId}
          targetPath={resolvedPath}
          message={scanMessage}
          isComplete={phase !== 'scanning'}
          issueCount={candidateIssues.length}
          costUsd={scanCost}
        />
      )}

      {/* Checking phase */}
      {(phase === 'checking' || phase === 'saving' || phase === 'complete') && candidateIssues.length > 0 && (
        <CheckingProgress
          issueCount={candidateIssues.length}
          checker={checkerStatus}
          isComplete={phase !== 'checking'}
        />
      )}

      {/* Saving indicator */}
      {phase === 'saving' && (
        <Box marginY={1}>
          <Text color="cyan">Saving approved issues...</Text>
        </Box>
      )}

      {/* Results */}
      {phase === 'complete' && (
        <Results
          approvedIssues={approvedIssues}
          rejectedIssues={rejectedIssues}
          ticketPaths={ticketPaths}
          durationMs={totalDuration}
          totalCost={totalCost}
        />
      )}
    </Box>
  );
}
