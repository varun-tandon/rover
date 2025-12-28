import React, { useState, useEffect, useCallback, useRef } from 'react';
import { Box, Text, useApp } from 'ink';
import type { CandidateIssue, ApprovedIssue, VoterStatus, Vote } from '../types/index.js';
import { ScanProgress } from './ScanProgress.js';
import { VotingProgress } from './VotingProgress.js';
import { Results } from './Results.js';
import { getAgent, getAgentIds, runScanner, runVotersInParallel, runArbitrator } from '../agents/index.js';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { throttle } from '../utils/throttle.js';

type Phase = 'init' | 'scanning' | 'voting' | 'arbitrating' | 'complete' | 'error';

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
  const [voterStatuses, setVoterStatuses] = useState<VoterStatus[]>([]);
  const [votes, setVotes] = useState<Vote[]>([]);
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

  // Initialize voter statuses
  const initVoterStatuses = useCallback((issueCount: number): VoterStatus[] => {
    return [1, 2, 3].map(i => ({
      id: `voter-${i}`,
      status: 'pending' as const,
      votesCompleted: 0,
      totalVotes: issueCount
    }));
  }, []);

  // Update voter progress with throttling to avoid excessive re-renders.
  // 300ms throttle (vs 200ms for scan messages) because voter status updates are less
  // time-critical for user feedback and happen more frequently (3 voters x N issues).
  const throttledIncrementVoterProgress = useRef(
    throttle((voterId: string) => {
      setVoterStatuses(prev => prev.map(voterStatus =>
        voterStatus.id === voterId
          ? { ...voterStatus, status: 'voting' as const, votesCompleted: voterStatus.votesCompleted + 1 }
          : voterStatus
      ));
    }, 300)
  ).current;

  // Callback for voter progress updates
  const updateVoterProgress = useCallback((
    voterId: string,
    _issueId: string,
    completed: boolean
  ) => {
    if (completed) {
      throttledIncrementVoterProgress(voterId);
    }
  }, [throttledIncrementVoterProgress]);

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

        // Phase 2: Voting
        setPhase('voting');
        const initialStatuses = initVoterStatuses(scanResult.issues.length);
        setVoterStatuses(initialStatuses);

        // Start all voters with 'voting' status
        setVoterStatuses(prev => prev.map(voterStatus => ({ ...voterStatus, status: 'voting' as const })));

        const voterResults = await runVotersInParallel(
          resolvedPath,
          agentId,
          scanResult.issues,
          3,
          updateVoterProgress
        );

        // Mark all voters as complete and collect votes
        setVoterStatuses(prev => prev.map(voterStatus => ({
          ...voterStatus,
          status: 'completed' as const,
          votesCompleted: voterStatus.totalVotes
        })));

        const allVotes = voterResults.flatMap(voterResult => voterResult.votes);
        setVotes(allVotes);

        // Phase 3: Arbitration
        setPhase('arbitrating');

        const arbitratorResult = await runArbitrator({
          targetPath: resolvedPath,
          candidateIssues: scanResult.issues,
          votes: allVotes,
          minimumVotes: 2
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
  }, [command, agentId, agent, resolvedPath, flags.dryRun, initVoterStatuses, updateVoterProgress, throttledSetScanMessage, throttledSetScanCost]);

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
      {(phase === 'scanning' || phase === 'voting' || phase === 'arbitrating' || phase === 'complete') && (
        <ScanProgress
          agentName={agent?.name ?? agentId}
          targetPath={resolvedPath}
          message={scanMessage}
          isComplete={phase !== 'scanning'}
          issueCount={candidateIssues.length}
          costUsd={scanCost}
        />
      )}

      {/* Voting phase */}
      {(phase === 'voting' || phase === 'arbitrating' || phase === 'complete') && candidateIssues.length > 0 && (
        <VotingProgress
          issueCount={candidateIssues.length}
          voters={voterStatuses}
          isComplete={phase !== 'voting'}
        />
      )}

      {/* Arbitration indicator */}
      {phase === 'arbitrating' && (
        <Box marginY={1}>
          <Text color="cyan">Arbitrating votes and creating tickets...</Text>
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
