import { jsxs as _jsxs, jsx as _jsx } from "react/jsx-runtime";
import { useState, useEffect, useRef } from 'react';
import { Box, Text, useApp } from 'ink';
import Spinner from 'ink-spinner';
import { runAgentsBatched, getAgentIds, getAgent } from '../agents/index.js';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { throttle } from '../utils/throttle.js';
import { loadRunState, saveRunState, clearRunState, createRunState, getCompletedAgentIds, updateAgentStatus, markRunComplete } from '../storage/run-state.js';
export function BatchApp({ targetPath, flags }) {
    const { exit } = useApp();
    const resolvedPath = targetPath ? resolve(targetPath) : process.cwd();
    const [phase, setPhase] = useState('init');
    const [error, setError] = useState(null);
    const [currentProgress, setCurrentProgress] = useState(null);
    const [agentStatuses, setAgentStatuses] = useState([]);
    const [result, setResult] = useState(null);
    const [skippedCount, setSkippedCount] = useState(0);
    // Throttled progress update - 150ms (faster than single-agent 200ms) because batch mode
    // has less frequent updates per agent and users benefit from snappier feedback during
    // the longer overall batch execution time.
    const throttledSetProgress = useRef(throttle((progress) => setCurrentProgress(progress), 150)).current;
    // Ref to hold mutable run state (avoids stale closures in callbacks)
    const runStateRef = useRef(null);
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
            let skipAgentIds = [];
            if (flags.resume) {
                const existingState = await loadRunState(resolvedPath);
                if (existingState && existingState.completedAt === null) {
                    // Resume from existing state
                    runStateRef.current = existingState;
                    skipAgentIds = getCompletedAgentIds(existingState);
                    setSkippedCount(skipAgentIds.length);
                }
                else {
                    // No valid state to resume, create fresh
                    runStateRef.current = createRunState(resolvedPath, agentIds, flags.concurrency ?? 4, (id) => getAgent(id)?.name ?? id);
                }
            }
            else {
                // Fresh run - clear any existing state
                await clearRunState(resolvedPath);
                runStateRef.current = createRunState(resolvedPath, agentIds, flags.concurrency ?? 4, (id) => getAgent(id)?.name ?? id);
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
                        setAgentStatuses(prev => prev.map(s => s.agentId === progress.agentId
                            ? { ...s, status: 'running', agentName: progress.agentName }
                            : s));
                    },
                    onAgentComplete: (agentResult) => {
                        setAgentStatuses(prev => prev.map(s => s.agentId === agentResult.agentId
                            ? {
                                ...s,
                                status: agentResult.error ? 'error' : 'complete',
                                agentName: agentResult.agentName,
                                candidateIssues: agentResult.scanResult.issues.length,
                                approvedIssues: agentResult.arbitratorResult.approvedIssues.length
                            }
                            : s));
                    },
                    onStateChange: async (agentId, status, agentResult) => {
                        if (!runStateRef.current)
                            return;
                        // Build result summary if agent completed successfully
                        let resultSummary;
                        if (status === 'completed' && agentResult && !agentResult.error) {
                            resultSummary = {
                                candidateIssues: agentResult.scanResult.issues.length,
                                approvedIssues: agentResult.arbitratorResult.approvedIssues.length,
                                rejectedIssues: agentResult.arbitratorResult.rejectedIssues.length,
                                ticketsCreated: agentResult.arbitratorResult.ticketsCreated.length,
                            };
                        }
                        // Update state
                        runStateRef.current = updateAgentStatus(runStateRef.current, agentId, status, {
                            error: agentResult?.error,
                            result: resultSummary,
                            agentName: agentResult?.agentName
                        });
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
            }
            catch (err) {
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
        return (_jsx(Box, { flexDirection: "column", marginY: 1, children: _jsxs(Text, { color: "red", bold: true, children: ["Error: ", error] }) }));
    }
    if (phase === 'init') {
        return (_jsx(Box, { marginY: 1, children: _jsx(Text, { dimColor: true, children: "Initializing batch scan..." }) }));
    }
    const completedAgents = agentStatuses.filter(s => s.status === 'complete').length;
    const runningAgents = agentStatuses.filter(s => s.status === 'running');
    return (_jsxs(Box, { flexDirection: "column", children: [_jsxs(Box, { borderStyle: "round", borderColor: "cyan", padding: 1, marginBottom: 1, children: [_jsx(Text, { color: "cyan", bold: true, children: "ROVER" }), _jsxs(Text, { children: [" - Batch Scan (", agentStatuses.length, " agents)"] })] }), phase === 'running' && (_jsxs(Box, { flexDirection: "column", marginBottom: 1, children: [_jsxs(Box, { marginBottom: 1, children: [_jsx(Text, { children: "Progress: " }), _jsx(Text, { color: "green", bold: true, children: completedAgents }), _jsxs(Text, { children: ["/", agentStatuses.length, " agents complete"] }), skippedCount > 0 && (_jsxs(Text, { dimColor: true, children: [" (", skippedCount, " resumed)"] }))] }), runningAgents.length > 0 && (_jsx(Box, { flexDirection: "column", paddingLeft: 2, children: runningAgents.map(agent => (_jsxs(Box, { gap: 1, children: [_jsx(Text, { color: "cyan", children: _jsx(Spinner, { type: "dots" }) }), _jsx(Text, { children: agent.agentName })] }, agent.agentId))) })), currentProgress && (_jsx(Box, { marginTop: 1, children: _jsx(Text, { dimColor: true, children: currentProgress.message }) }))] })), phase === 'complete' && result && (_jsxs(Box, { flexDirection: "column", children: [_jsx(Box, { borderStyle: "double", borderColor: "green", padding: 1, marginBottom: 1, children: _jsx(Text, { color: "green", bold: true, children: "Batch Scan Complete" }) }), _jsxs(Box, { flexDirection: "column", marginBottom: 1, children: [_jsx(Box, { gap: 2, children: _jsxs(Box, { children: [_jsx(Text, { dimColor: true, children: "Duration: " }), _jsxs(Text, { children: [(result.totalDurationMs / 1000).toFixed(1), "s"] })] }) }), _jsxs(Box, { gap: 2, children: [_jsxs(Box, { children: [_jsx(Text, { dimColor: true, children: "Agents run: " }), _jsx(Text, { children: result.agentResults.length }), result.skippedAgents > 0 && (_jsxs(Text, { dimColor: true, children: [" (+", result.skippedAgents, " resumed)"] }))] }), _jsxs(Box, { children: [_jsx(Text, { dimColor: true, children: "Candidates: " }), _jsx(Text, { color: "yellow", children: result.totalCandidateIssues })] }), _jsxs(Box, { children: [_jsx(Text, { dimColor: true, children: "Approved: " }), _jsx(Text, { color: "green", bold: true, children: result.totalApprovedIssues })] }), _jsxs(Box, { children: [_jsx(Text, { dimColor: true, children: "Rejected: " }), _jsx(Text, { color: "red", children: result.totalRejectedIssues })] })] }), _jsxs(Box, { children: [_jsx(Text, { dimColor: true, children: "Tickets created: " }), _jsx(Text, { color: "cyan", bold: true, children: result.totalTickets })] })] }), _jsxs(Box, { flexDirection: "column", children: [_jsx(Text, { bold: true, children: "Results by Agent:" }), _jsx(Box, { flexDirection: "column", paddingLeft: 2, marginTop: 1, children: result.agentResults
                                    .filter(agentResult => agentResult.scanResult.issues.length > 0 || agentResult.arbitratorResult.approvedIssues.length > 0)
                                    .map(agentResult => (_jsxs(Box, { gap: 1, children: [_jsx(Text, { color: agentResult.arbitratorResult.approvedIssues.length > 0 ? 'yellow' : 'gray', children: agentResult.arbitratorResult.approvedIssues.length > 0 ? '!' : '·' }), _jsxs(Text, { children: [agentResult.agentName, ":"] }), _jsxs(Text, { dimColor: true, children: [agentResult.scanResult.issues.length, " found,", ' ', _jsxs(Text, { color: "green", children: [agentResult.arbitratorResult.approvedIssues.length, " approved"] })] })] }, agentResult.agentId))) }), result.totalApprovedIssues === 0 && (_jsx(Box, { marginTop: 1, children: _jsx(Text, { color: "green", children: "No issues found across all agents!" }) }))] }), result.totalTickets > 0 && (_jsxs(Box, { marginTop: 1, children: [_jsx(Text, { dimColor: true, children: "Tickets saved to: " }), _jsxs(Text, { color: "blue", children: [resolvedPath, "/.rover/tickets/"] })] }))] }))] }));
}
