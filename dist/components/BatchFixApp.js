import { jsxs as _jsxs, jsx as _jsx } from "react/jsx-runtime";
import { useState, useEffect, useRef } from 'react';
import { Box, Text, useApp } from 'ink';
import Spinner from 'ink-spinner';
import { resolve } from 'node:path';
import { runBatchFix } from '../fix/index.js';
import { throttle } from '../utils/throttle.js';
function getPhaseIcon(phase) {
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
function getPhaseColor(phase) {
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
export function BatchFixApp({ targetPath, issueIds, flags }) {
    const { exit } = useApp();
    const resolvedPath = resolve(targetPath);
    const [phase, setPhase] = useState('init');
    const [error, setError] = useState(null);
    const [currentProgress, setCurrentProgress] = useState(null);
    const [result, setResult] = useState(null);
    // Throttled progress update
    const throttledUpdateProgress = useRef(throttle((progress) => {
        setCurrentProgress(progress);
    }, 100)).current;
    useEffect(() => {
        async function runBatchFixWorkflow() {
            setPhase('running');
            try {
                const batchResult = await runBatchFix({
                    targetPath: resolvedPath,
                    issueIds,
                    maxIterations: flags.maxIterations,
                    verbose: flags.verbose,
                }, (progress) => {
                    throttledUpdateProgress(progress);
                });
                setResult(batchResult);
                setPhase('complete');
            }
            catch (err) {
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
        return (_jsx(Box, { flexDirection: "column", marginY: 1, children: _jsxs(Text, { color: "red", bold: true, children: ["Error: ", error] }) }));
    }
    if (phase === 'init') {
        return (_jsx(Box, { marginY: 1, children: _jsx(Text, { dimColor: true, children: "Initializing batch fix workflow..." }) }));
    }
    return (_jsxs(Box, { flexDirection: "column", children: [_jsxs(Box, { borderStyle: "round", borderColor: "cyan", padding: 1, marginBottom: 1, children: [_jsx(Text, { color: "cyan", bold: true, children: "ROVER" }), _jsxs(Text, { children: [" - Batch Fix (", issueIds.length, " issue", issueIds.length !== 1 ? 's' : '', " in single branch)"] })] }), phase === 'running' && currentProgress && (_jsxs(Box, { flexDirection: "column", marginBottom: 1, children: [_jsxs(Box, { marginBottom: 1, gap: 1, children: [_jsx(Text, { color: "cyan", children: _jsx(Spinner, { type: "dots" }) }), _jsxs(Text, { bold: true, children: [currentProgress.phase === 'worktree' && 'Creating worktree...', currentProgress.phase === 'fixing' && `Fixing issues (${currentProgress.currentIssueIndex ?? 0}/${currentProgress.totalIssues})...`, currentProgress.phase === 'reviewing' && `Reviewing (iteration ${currentProgress.iteration ?? 1})...`] })] }), _jsx(Box, { paddingLeft: 2, children: _jsx(Text, { dimColor: true, children: currentProgress.message }) })] })), phase === 'complete' && result && (_jsxs(Box, { flexDirection: "column", children: [_jsx(Box, { borderStyle: "double", borderColor: result.status === 'error' ? 'red' : 'green', padding: 1, marginBottom: 1, children: _jsxs(Text, { color: result.status === 'error' ? 'red' : 'green', bold: true, children: ["Batch Fix ", result.status === 'error' ? 'Failed' : 'Complete'] }) }), _jsx(Box, { flexDirection: "column", marginBottom: 1, children: _jsxs(Box, { gap: 2, children: [_jsxs(Box, { children: [_jsx(Text, { dimColor: true, children: "Total issues: " }), _jsx(Text, { children: issueIds.length })] }), _jsxs(Box, { children: [_jsx(Text, { dimColor: true, children: "Fixed: " }), _jsx(Text, { color: "green", bold: true, children: result.successCount })] }), result.failedCount > 0 && (_jsxs(Box, { children: [_jsx(Text, { dimColor: true, children: "Skipped/Failed: " }), _jsx(Text, { color: "yellow", children: result.failedCount })] })), _jsxs(Box, { children: [_jsx(Text, { dimColor: true, children: "Iterations: " }), _jsx(Text, { children: result.iterations })] })] }) }), result.branchName && (_jsxs(Box, { flexDirection: "column", marginBottom: 1, children: [_jsxs(Box, { children: [_jsx(Text, { dimColor: true, children: "Branch: " }), _jsx(Text, { color: "cyan", children: result.branchName })] }), result.worktreePath && (_jsxs(Box, { children: [_jsx(Text, { dimColor: true, children: "Worktree: " }), _jsx(Text, { color: "blue", children: result.worktreePath })] }))] })), _jsxs(Box, { flexDirection: "column", children: [_jsx(Text, { bold: true, children: "Issue Results:" }), _jsx(Box, { flexDirection: "column", paddingLeft: 2, marginTop: 1, children: result.issueResults.map((issueResult) => {
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
                                    return (_jsxs(Box, { gap: 1, children: [_jsx(Text, { color: color, children: icon }), _jsxs(Text, { bold: true, children: ["[", issueResult.issueId, "]"] }), _jsx(Text, { dimColor: true, children: issueResult.status === 'success'
                                                    ? 'Fixed'
                                                    : issueResult.error ?? issueResult.status })] }, issueResult.issueId));
                                }) })] }), result.successCount > 0 && result.status !== 'error' && (_jsxs(Box, { marginTop: 1, flexDirection: "column", children: [_jsx(Text, { bold: true, children: "Next steps:" }), _jsxs(Box, { paddingLeft: 2, flexDirection: "column", children: [_jsx(Text, { dimColor: true, children: "1. Review the changes in the worktree" }), _jsxs(Text, { dimColor: true, children: ["2. Create a pull request: rover review submit ", result.issueResults[0]?.issueId] }), _jsxs(Text, { dimColor: true, children: ["   (All ", result.successCount, " fixes will be included in one PR)"] })] })] })), result.error && (_jsx(Box, { marginTop: 1, children: _jsxs(Text, { color: "red", children: ["Error: ", result.error] }) }))] }))] }));
}
