import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { useState, useEffect } from 'react';
import { Box, Text, useApp } from 'ink';
import Spinner from 'ink-spinner';
import { resolve } from 'node:path';
import { listFixes, createPR, createAllPRs, cleanupFix, cleanupAllFixes, } from '../fix/review-manager.js';
function getStatusIcon(status) {
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
function getStatusColor(status) {
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
function getStatusLabel(status) {
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
function ReviewList({ targetPath }) {
    const { exit } = useApp();
    const [loading, setLoading] = useState(true);
    const [fixes, setFixes] = useState([]);
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
        return (_jsxs(Box, { marginY: 1, children: [_jsx(Text, { color: "cyan", children: _jsx(Spinner, { type: "dots" }) }), _jsx(Text, { children: " Loading fixes..." })] }));
    }
    if (fixes.length === 0) {
        return (_jsxs(Box, { flexDirection: "column", marginY: 1, children: [_jsx(Text, { dimColor: true, children: "No fixes found." }), _jsx(Text, { dimColor: true, children: "Run `rover fix ISSUE-XXX` to create fixes." })] }));
    }
    return (_jsxs(Box, { flexDirection: "column", children: [_jsxs(Box, { borderStyle: "round", borderColor: "cyan", padding: 1, marginBottom: 1, children: [_jsx(Text, { color: "cyan", bold: true, children: "ROVER" }), _jsxs(Text, { children: [" - Review Fixes (", fixes.length, " total)"] })] }), _jsxs(Box, { gap: 2, marginBottom: 1, children: [_jsxs(Box, { children: [_jsx(Text, { dimColor: true, children: "Ready: " }), _jsx(Text, { color: "yellow", bold: true, children: stats.ready })] }), _jsxs(Box, { children: [_jsx(Text, { dimColor: true, children: "PR Created: " }), _jsx(Text, { color: "green", bold: true, children: stats.prCreated })] }), stats.error > 0 && (_jsxs(Box, { children: [_jsx(Text, { dimColor: true, children: "Errors: " }), _jsx(Text, { color: "red", bold: true, children: stats.error })] }))] }), _jsx(Box, { flexDirection: "column", paddingLeft: 2, children: fixes.map((fix) => (_jsxs(Box, { flexDirection: "column", marginBottom: 1, children: [_jsxs(Box, { gap: 1, children: [_jsx(Text, { color: getStatusColor(fix.status), children: getStatusIcon(fix.status) }), _jsxs(Text, { bold: true, children: ["[", fix.issueId, "]"] }), _jsx(Text, { color: getStatusColor(fix.status), children: getStatusLabel(fix.status) })] }), _jsxs(Box, { paddingLeft: 4, children: [_jsx(Text, { dimColor: true, children: "Branch: " }), _jsx(Text, { color: "cyan", children: fix.branchName })] }), fix.prUrl && (_jsxs(Box, { paddingLeft: 4, children: [_jsx(Text, { dimColor: true, children: "PR: " }), _jsx(Text, { color: "blue", children: fix.prUrl })] })), _jsxs(Box, { paddingLeft: 4, children: [_jsx(Text, { dimColor: true, children: "Worktree: " }), _jsx(Text, { children: fix.worktreePath })] })] }, fix.issueId))) }), stats.ready > 0 && (_jsxs(Box, { marginTop: 1, flexDirection: "column", children: [_jsx(Text, { bold: true, children: "Next steps:" }), _jsxs(Box, { paddingLeft: 2, flexDirection: "column", children: [_jsx(Text, { dimColor: true, children: "rover review submit ISSUE-XXX  - Create PR for a specific fix" }), _jsx(Text, { dimColor: true, children: "rover review submit --all      - Create PRs for all ready fixes" }), _jsx(Text, { dimColor: true, children: "rover review clean ISSUE-XXX   - Remove a fix worktree" })] })] }))] }));
}
function ReviewSubmit({ targetPath, issueId, all, draft, }) {
    const { exit } = useApp();
    const [phase, setPhase] = useState('working');
    const [currentIssue, setCurrentIssue] = useState(null);
    const [statusMessage, setStatusMessage] = useState('');
    const [results, setResults] = useState([]);
    const [error, setError] = useState(null);
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
            }
            else if (issueId) {
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
            }
            else {
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
        return (_jsxs(Box, { marginY: 1, flexDirection: "column", children: [_jsxs(Box, { children: [_jsx(Text, { color: "cyan", children: _jsx(Spinner, { type: "dots" }) }), _jsxs(Text, { children: [" Creating PR", all ? 's' : '', currentIssue ? ` for ${currentIssue}` : '', "..."] })] }), statusMessage && (_jsx(Box, { paddingLeft: 2, children: _jsxs(Text, { dimColor: true, children: ["\u2192 ", statusMessage] }) }))] }));
    }
    if (phase === 'error') {
        return (_jsx(Box, { flexDirection: "column", marginY: 1, children: _jsxs(Text, { color: "red", bold: true, children: ["Error: ", error] }) }));
    }
    const successCount = results.filter((r) => r.success && !r.error?.includes('already exists')).length;
    const existingCount = results.filter((r) => r.error?.includes('already exists')).length;
    const failedCount = results.filter((r) => !r.success).length;
    return (_jsxs(Box, { flexDirection: "column", children: [_jsx(Box, { borderStyle: "double", borderColor: "green", padding: 1, marginBottom: 1, children: _jsx(Text, { color: "green", bold: true, children: "PR Creation Complete" }) }), _jsxs(Box, { gap: 2, marginBottom: 1, children: [_jsxs(Box, { children: [_jsx(Text, { dimColor: true, children: "Created: " }), _jsx(Text, { color: "green", bold: true, children: successCount })] }), existingCount > 0 && (_jsxs(Box, { children: [_jsx(Text, { dimColor: true, children: "Already existed: " }), _jsx(Text, { color: "blue", children: existingCount })] })), failedCount > 0 && (_jsxs(Box, { children: [_jsx(Text, { dimColor: true, children: "Failed: " }), _jsx(Text, { color: "red", children: failedCount })] }))] }), _jsx(Box, { flexDirection: "column", paddingLeft: 2, children: results.map((result) => (_jsx(Box, { flexDirection: "column", marginBottom: 1, children: _jsxs(Box, { gap: 1, children: [_jsx(Text, { color: result.success ? 'green' : 'red', children: result.success ? '✓' : '✗' }), _jsxs(Text, { bold: true, children: ["[", result.issueId, "]"] }), result.prUrl && (_jsx(Text, { color: "blue", children: result.prUrl })), result.error && !result.prUrl && (_jsx(Text, { color: "red", children: result.error }))] }) }, result.issueId))) })] }));
}
function ReviewClean({ targetPath, issueId, }) {
    const { exit } = useApp();
    const [phase, setPhase] = useState('working');
    const [error, setError] = useState(null);
    useEffect(() => {
        async function clean() {
            const result = await cleanupFix(targetPath, issueId);
            if (result.success) {
                setPhase('done');
            }
            else {
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
        return (_jsxs(Box, { marginY: 1, children: [_jsx(Text, { color: "cyan", children: _jsx(Spinner, { type: "dots" }) }), _jsxs(Text, { children: [" Cleaning up ", issueId, "..."] })] }));
    }
    if (phase === 'error') {
        return (_jsx(Box, { flexDirection: "column", marginY: 1, children: _jsxs(Text, { color: "red", bold: true, children: ["Error: ", error] }) }));
    }
    return (_jsxs(Box, { flexDirection: "column", marginY: 1, children: [_jsxs(Text, { color: "green", bold: true, children: ["\u2713 Cleaned up ", issueId] }), _jsx(Text, { dimColor: true, children: "Worktree removed and fix record deleted." })] }));
}
function ReviewCleanAll({ targetPath }) {
    const { exit } = useApp();
    const [phase, setPhase] = useState('working');
    const [currentIssue, setCurrentIssue] = useState(null);
    const [statusMessage, setStatusMessage] = useState('');
    const [results, setResults] = useState([]);
    const [error, setError] = useState(null);
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
            }
            else {
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
        return (_jsxs(Box, { marginY: 1, flexDirection: "column", children: [_jsxs(Box, { children: [_jsx(Text, { color: "cyan", children: _jsx(Spinner, { type: "dots" }) }), _jsxs(Text, { children: [" Cleaning up all fixes", currentIssue ? ` (${currentIssue})` : '', "..."] })] }), statusMessage && (_jsx(Box, { paddingLeft: 2, children: _jsxs(Text, { dimColor: true, children: ["\u2192 ", statusMessage] }) }))] }));
    }
    if (phase === 'error') {
        return (_jsx(Box, { flexDirection: "column", marginY: 1, children: _jsxs(Text, { color: "red", bold: true, children: ["Error: ", error] }) }));
    }
    const successCount = results.filter((r) => r.success).length;
    const failedCount = results.filter((r) => !r.success).length;
    return (_jsxs(Box, { flexDirection: "column", children: [_jsx(Box, { borderStyle: "double", borderColor: "green", padding: 1, marginBottom: 1, children: _jsx(Text, { color: "green", bold: true, children: "Cleanup Complete" }) }), _jsxs(Box, { gap: 2, marginBottom: 1, children: [_jsxs(Box, { children: [_jsx(Text, { dimColor: true, children: "Cleaned: " }), _jsx(Text, { color: "green", bold: true, children: successCount })] }), failedCount > 0 && (_jsxs(Box, { children: [_jsx(Text, { dimColor: true, children: "Failed: " }), _jsx(Text, { color: "red", children: failedCount })] }))] }), _jsx(Box, { flexDirection: "column", paddingLeft: 2, children: results.map((result) => (_jsxs(Box, { gap: 1, children: [_jsx(Text, { color: result.success ? 'green' : 'red', children: result.success ? '✓' : '✗' }), _jsxs(Text, { bold: true, children: ["[", result.issueId, "]"] }), result.error && (_jsx(Text, { color: "red", children: result.error }))] }, result.issueId))) })] }));
}
export function ReviewApp({ targetPath, subcommand, issueId, flags }) {
    const resolvedPath = resolve(targetPath);
    switch (subcommand) {
        case 'list':
            return _jsx(ReviewList, { targetPath: resolvedPath });
        case 'submit':
            return (_jsx(ReviewSubmit, { targetPath: resolvedPath, issueId: issueId, all: flags.all, draft: flags.draft }));
        case 'clean':
            if (flags.all) {
                return _jsx(ReviewCleanAll, { targetPath: resolvedPath });
            }
            if (!issueId) {
                return (_jsx(Box, { marginY: 1, children: _jsx(Text, { color: "red", children: "Error: Issue ID required for clean command" }) }));
            }
            return _jsx(ReviewClean, { targetPath: resolvedPath, issueId: issueId });
    }
}
