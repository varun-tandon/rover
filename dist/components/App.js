import { jsxs as _jsxs, jsx as _jsx } from "react/jsx-runtime";
import { useState, useEffect, useCallback, useRef } from 'react';
import { Box, Text, useApp } from 'ink';
import { ScanProgress } from './ScanProgress.js';
import { VotingProgress } from './VotingProgress.js';
import { Results } from './Results.js';
import { getAgent, getAgentIds, runScanner, runVotersInParallel, runArbitrator } from '../agents/index.js';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { throttle } from '../utils/throttle.js';
export function App({ command, targetPath, flags }) {
    const { exit } = useApp();
    // State
    const [phase, setPhase] = useState('init');
    const [error, setError] = useState(null);
    const [scanMessage, setScanMessage] = useState('Initializing...');
    const [candidateIssues, setCandidateIssues] = useState([]);
    const [voterStatuses, setVoterStatuses] = useState([]);
    const [votes, setVotes] = useState([]);
    const [approvedIssues, setApprovedIssues] = useState([]);
    const [rejectedIssues, setRejectedIssues] = useState([]);
    const [ticketPaths, setTicketPaths] = useState([]);
    const [totalDuration, setTotalDuration] = useState(0);
    const [totalCost, setTotalCost] = useState(0);
    const [scanCost, setScanCost] = useState(0);
    const agentId = flags.agent ?? 'security-auditor';
    const agent = getAgent(agentId);
    const resolvedPath = targetPath ? resolve(targetPath) : process.cwd();
    // Throttled message setter - 200ms balances UI responsiveness (feels instant to users)
    // with React render performance (avoids excessive re-renders during rapid file scanning)
    const throttledSetScanMessage = useRef(throttle((msg) => setScanMessage(msg), 200)).current;
    // Throttled cost setter for realtime cost updates
    const throttledSetScanCost = useRef(throttle((cost) => setScanCost(cost), 200)).current;
    // Initialize voter statuses
    const initVoterStatuses = useCallback((issueCount) => {
        return [1, 2, 3].map(i => ({
            id: `voter-${i}`,
            status: 'pending',
            votesCompleted: 0,
            totalVotes: issueCount
        }));
    }, []);
    // Update voter progress with throttling to avoid excessive re-renders.
    // 300ms throttle (vs 200ms for scan messages) because voter status updates are less
    // time-critical for user feedback and happen more frequently (3 voters x N issues).
    const throttledIncrementVoterProgress = useRef(throttle((voterId) => {
        setVoterStatuses(prev => prev.map(voterStatus => voterStatus.id === voterId
            ? { ...voterStatus, status: 'voting', votesCompleted: voterStatus.votesCompleted + 1 }
            : voterStatus));
    }, 300)).current;
    // Callback for voter progress updates
    const updateVoterProgress = useCallback((voterId, _issueId, completed) => {
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
                setVoterStatuses(prev => prev.map(voterStatus => ({ ...voterStatus, status: 'voting' })));
                const voterResults = await runVotersInParallel(resolvedPath, agentId, scanResult.issues, 3, updateVoterProgress);
                // Mark all voters as complete and collect votes
                setVoterStatuses(prev => prev.map(voterStatus => ({
                    ...voterStatus,
                    status: 'completed',
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
            }
            catch (err) {
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
        return (_jsx(Box, { flexDirection: "column", marginY: 1, children: _jsxs(Text, { color: "red", bold: true, children: ["Error: ", error] }) }));
    }
    if (phase === 'init') {
        return (_jsx(Box, { marginY: 1, children: _jsx(Text, { dimColor: true, children: "Initializing Rover..." }) }));
    }
    return (_jsxs(Box, { flexDirection: "column", children: [_jsxs(Box, { borderStyle: "round", borderColor: "cyan", padding: 1, marginBottom: 1, children: [_jsx(Text, { color: "cyan", bold: true, children: "ROVER" }), _jsx(Text, { children: " - AI Codebase Scanner" })] }), (phase === 'scanning' || phase === 'voting' || phase === 'arbitrating' || phase === 'complete') && (_jsx(ScanProgress, { agentName: agent?.name ?? agentId, targetPath: resolvedPath, message: scanMessage, isComplete: phase !== 'scanning', issueCount: candidateIssues.length, costUsd: scanCost })), (phase === 'voting' || phase === 'arbitrating' || phase === 'complete') && candidateIssues.length > 0 && (_jsx(VotingProgress, { issueCount: candidateIssues.length, voters: voterStatuses, isComplete: phase !== 'voting' })), phase === 'arbitrating' && (_jsx(Box, { marginY: 1, children: _jsx(Text, { color: "cyan", children: "Arbitrating votes and creating tickets..." }) })), phase === 'complete' && (_jsx(Results, { approvedIssues: approvedIssues, rejectedIssues: rejectedIssues, ticketPaths: ticketPaths, durationMs: totalDuration, totalCost: totalCost }))] }));
}
