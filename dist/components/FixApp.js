import { jsxs as _jsxs, jsx as _jsx } from "react/jsx-runtime";
import { useState, useEffect, useRef } from 'react';
import { Box, Text, useApp } from 'ink';
import Spinner from 'ink-spinner';
import { resolve } from 'node:path';
import { runFix } from '../fix/index.js';
import { throttle } from '../utils/throttle.js';
function getPhaseIcon(phase) {
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
function getPhaseColor(phase) {
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
export function FixApp({ targetPath, issueIds, flags }) {
    const { exit } = useApp();
    const resolvedPath = resolve(targetPath);
    const [phase, setPhase] = useState('init');
    const [error, setError] = useState(null);
    const [issueStatuses, setIssueStatuses] = useState(new Map());
    const [results, setResults] = useState([]);
    // Throttled progress update
    const throttledUpdateStatus = useRef(throttle((progress) => {
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
    }, 100)).current;
    useEffect(() => {
        async function runFixWorkflow() {
            // Initialize statuses
            const initialStatuses = new Map();
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
                const fixResults = await runFix({
                    targetPath: resolvedPath,
                    issueIds,
                    concurrency: flags.concurrency,
                    maxIterations: flags.maxIterations,
                    verbose: flags.verbose,
                }, (progress) => {
                    throttledUpdateStatus(progress);
                });
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
                            message: result.status === 'success'
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
            }
            catch (err) {
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
        return (_jsx(Box, { flexDirection: "column", marginY: 1, children: _jsxs(Text, { color: "red", bold: true, children: ["Error: ", error] }) }));
    }
    if (phase === 'init') {
        return (_jsx(Box, { marginY: 1, children: _jsx(Text, { dimColor: true, children: "Initializing fix workflow..." }) }));
    }
    const statusList = Array.from(issueStatuses.values());
    const completedCount = statusList.filter((s) => s.phase === 'complete' || s.phase === 'already_fixed' || s.phase === 'error').length;
    const successCount = results.filter((r) => r.status === 'success').length;
    const alreadyFixedCount = results.filter((r) => r.status === 'already_fixed').length;
    const errorCount = results.filter((r) => r.status === 'error').length;
    const iterationLimitCount = results.filter((r) => r.status === 'iteration_limit').length;
    return (_jsxs(Box, { flexDirection: "column", children: [_jsxs(Box, { borderStyle: "round", borderColor: "cyan", padding: 1, marginBottom: 1, children: [_jsx(Text, { color: "cyan", bold: true, children: "ROVER" }), _jsxs(Text, { children: [" - Fix Issues (", issueIds.length, " issue", issueIds.length !== 1 ? 's' : '', ")"] })] }), phase === 'running' && (_jsxs(Box, { flexDirection: "column", marginBottom: 1, children: [_jsxs(Box, { marginBottom: 1, children: [_jsx(Text, { children: "Progress: " }), _jsx(Text, { color: "green", bold: true, children: completedCount }), _jsxs(Text, { children: ["/", issueIds.length, " issues"] })] }), _jsx(Box, { flexDirection: "column", paddingLeft: 2, children: statusList.map((status) => (_jsxs(Box, { flexDirection: "column", marginBottom: 1, children: [_jsxs(Box, { gap: 1, children: [status.phase === 'pending' || status.phase === 'complete' || status.phase === 'error' ? (_jsx(Text, { color: getPhaseColor(status.phase), children: getPhaseIcon(status.phase) })) : (_jsx(Text, { color: "cyan", children: _jsx(Spinner, { type: "dots" }) })), _jsxs(Text, { bold: true, children: ["[", status.issueId, "]"] }), status.branchName && _jsx(Text, { dimColor: true, children: status.branchName })] }), _jsx(Box, { paddingLeft: 4, children: _jsx(Text, { dimColor: true, children: status.message }) }), status.actionableItems !== undefined && status.actionableItems > 0 && (_jsx(Box, { paddingLeft: 4, children: _jsxs(Text, { color: "yellow", children: [status.actionableItems, " actionable item", status.actionableItems !== 1 ? 's' : '', " remaining"] }) }))] }, status.issueId))) })] })), phase === 'complete' && (_jsxs(Box, { flexDirection: "column", children: [_jsx(Box, { borderStyle: "double", borderColor: "green", padding: 1, marginBottom: 1, children: _jsx(Text, { color: "green", bold: true, children: "Fix Workflow Complete" }) }), _jsx(Box, { flexDirection: "column", marginBottom: 1, children: _jsxs(Box, { gap: 2, children: [_jsxs(Box, { children: [_jsx(Text, { dimColor: true, children: "Total: " }), _jsx(Text, { children: results.length })] }), _jsxs(Box, { children: [_jsx(Text, { dimColor: true, children: "Success: " }), _jsx(Text, { color: "green", bold: true, children: successCount })] }), alreadyFixedCount > 0 && (_jsxs(Box, { children: [_jsx(Text, { dimColor: true, children: "Already fixed: " }), _jsx(Text, { color: "blue", children: alreadyFixedCount })] })), iterationLimitCount > 0 && (_jsxs(Box, { children: [_jsx(Text, { dimColor: true, children: "Iteration limit: " }), _jsx(Text, { color: "yellow", children: iterationLimitCount })] })), errorCount > 0 && (_jsxs(Box, { children: [_jsx(Text, { dimColor: true, children: "Errors: " }), _jsx(Text, { color: "red", children: errorCount })] }))] }) }), _jsxs(Box, { flexDirection: "column", children: [_jsx(Text, { bold: true, children: "Results:" }), _jsx(Box, { flexDirection: "column", paddingLeft: 2, marginTop: 1, children: results.map((result) => {
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
                                    return (_jsxs(Box, { flexDirection: "column", marginBottom: 1, children: [_jsxs(Box, { gap: 1, children: [_jsx(Text, { color: color, children: icon }), _jsxs(Text, { bold: true, children: ["[", result.issueId, "]"] }), _jsx(Text, { dimColor: true, children: message })] }), result.worktreePath && (_jsxs(Box, { paddingLeft: 4, children: [_jsx(Text, { dimColor: true, children: "Worktree: " }), _jsx(Text, { color: "blue", children: result.worktreePath })] })), result.branchName && result.status !== 'already_fixed' && (_jsxs(Box, { paddingLeft: 4, children: [_jsx(Text, { dimColor: true, children: "Branch: " }), _jsx(Text, { color: "cyan", children: result.branchName })] }))] }, result.issueId));
                                }) })] }), successCount > 0 && (_jsxs(Box, { marginTop: 1, flexDirection: "column", children: [_jsx(Text, { bold: true, children: "Next steps:" }), _jsxs(Box, { paddingLeft: 2, flexDirection: "column", children: [_jsx(Text, { dimColor: true, children: "1. Review the changes in each worktree" }), _jsx(Text, { dimColor: true, children: "2. Create pull requests from the fix branches" }), _jsxs(Text, { dimColor: true, children: ["3. After merging, remove worktrees with: git worktree remove ", '<path>'] })] })] }))] }))] }));
}
