import React, { useState, useEffect, useCallback, useRef } from 'react';
import { Box, Text, useApp } from 'ink';
import type { CandidateIssue, ApprovedIssue, VoterStatus, Vote } from '../types/index.js';
import { ScanProgress } from './ScanProgress.js';
import { VotingProgress } from './VotingProgress.js';
import { Results } from './Results.js';
import { getAgent, getAgentIds, runScanner, runVotersInParallel, runArbitrator } from '../agents/index.js';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';

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

// Throttle function to limit UI updates
function throttle<T extends (...args: Parameters<T>) => void>(
  fn: T,
  delay: number
): T {
  let lastCall = 0;
  let timeoutId: NodeJS.Timeout | null = null;

  return ((...args: Parameters<T>) => {
    const now = Date.now();
    const timeSinceLastCall = now - lastCall;

    if (timeSinceLastCall >= delay) {
      lastCall = now;
      fn(...args);
    } else if (!timeoutId) {
      timeoutId = setTimeout(() => {
        lastCall = Date.now();
        timeoutId = null;
        fn(...args);
      }, delay - timeSinceLastCall);
    }
  }) as T;
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

  const agentId = flags.agent ?? 'critical-path-scout';
  const agent = getAgent(agentId);
  const resolvedPath = targetPath ? resolve(targetPath) : process.cwd();

  // Throttled message setter (update at most every 200ms)
  const throttledSetScanMessage = useRef(
    throttle((msg: string) => setScanMessage(msg), 200)
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

  // Track voter progress without triggering re-renders on every vote
  const voterProgressRef = useRef<Map<string, number>>(new Map());
  const throttledUpdateVoters = useRef(
    throttle(() => {
      setVoterStatuses(prev => prev.map(v => ({
        ...v,
        status: 'voting' as const,
        votesCompleted: voterProgressRef.current.get(v.id) ?? v.votesCompleted
      })));
    }, 300)
  ).current;

  // Update voter progress (throttled)
  const updateVoterProgress = useCallback((
    voterId: string,
    _issueId: string,
    completed: boolean
  ) => {
    if (completed) {
      const current = voterProgressRef.current.get(voterId) ?? 0;
      voterProgressRef.current.set(voterId, current + 1);
      throttledUpdateVoters();
    }
  }, [throttledUpdateVoters]);

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
          onProgress: throttledSetScanMessage
        });

        setCandidateIssues(scanResult.issues);
        cost += scanResult.costUsd;

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
        setVoterStatuses(prev => prev.map(v => ({ ...v, status: 'voting' as const })));

        const voterResults = await runVotersInParallel(
          resolvedPath,
          agentId,
          scanResult.issues,
          3,
          updateVoterProgress
        );

        // Mark all voters as complete and collect votes
        setVoterStatuses(prev => prev.map(v => ({
          ...v,
          status: 'completed' as const,
          votesCompleted: v.totalVotes
        })));

        const allVotes = voterResults.flatMap(r => r.votes);
        setVotes(allVotes);
        cost += voterResults.reduce((sum, r) => sum + r.costUsd, 0);

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
  }, [command, agentId, agent, resolvedPath, flags.dryRun, initVoterStatuses, updateVoterProgress, throttledSetScanMessage]);

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
