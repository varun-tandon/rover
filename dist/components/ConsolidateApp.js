import { jsxs as _jsxs, jsx as _jsx } from "react/jsx-runtime";
import { useState, useEffect, useRef } from 'react';
import { Box, Text, useApp } from 'ink';
import Spinner from 'ink-spinner';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { loadIssueStore, consolidateIssues } from '../storage/issues.js';
import { createConsolidatedTicketFile, deleteTicketFile, extractTicketId } from '../storage/tickets.js';
import { clusterIssues, getClusterStats } from '../agents/cluster.js';
import { runConsolidator } from '../agents/consolidator.js';
const DEFAULT_CONCURRENCY = 4;
export function ConsolidateApp({ targetPath, flags }) {
    const { exit } = useApp();
    const resolvedPath = targetPath ? resolve(targetPath) : process.cwd();
    const concurrency = flags.concurrency ?? DEFAULT_CONCURRENCY;
    const [phase, setPhase] = useState('init');
    const [error, setError] = useState(null);
    const [totalIssues, setTotalIssues] = useState(0);
    const [clusterStatuses, setClusterStatuses] = useState([]);
    const [currentMessages, setCurrentMessages] = useState(new Map());
    const [result, setResult] = useState(null);
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
                const clusterResults = [];
                const workQueue = [...issueClusters];
                let totalDurationMs = 0;
                // Worker function
                async function processWorker() {
                    while (workQueue.length > 0) {
                        const cluster = workQueue.shift();
                        if (!cluster)
                            break;
                        activeWorkersRef.current++;
                        // Update status to processing
                        setClusterStatuses(prev => prev.map(s => s.clusterId === cluster.id
                            ? { ...s, status: 'processing' }
                            : s));
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
                            setClusterStatuses(prev => prev.map(s => s.clusterId === cluster.id
                                ? { ...s, status: 'complete' }
                                : s));
                        }
                        catch (err) {
                            const errorMessage = err instanceof Error ? err.message : 'Unknown error';
                            clusterResults.push({ cluster, error: errorMessage });
                            setClusterStatuses(prev => prev.map(s => s.clusterId === cluster.id
                                ? { ...s, status: 'error', error: errorMessage }
                                : s));
                        }
                        finally {
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
                const workers = [];
                for (let i = 0; i < Math.min(concurrency, issueClusters.length); i++) {
                    workers.push(processWorker());
                }
                // Wait for all workers to complete
                await Promise.all(workers);
                // Phase 2: Apply file changes sequentially to avoid race conditions
                setPhase('applying');
                const consolidationSummary = {
                    clustersProcessed: 0,
                    issuesConsolidated: 0,
                    newTicketsCreated: [],
                    originalTicketsRemoved: [],
                    totalDurationMs
                };
                // Process successful results
                for (const { cluster, result: consolidatorResult, error: clusterError } of clusterResults) {
                    if (clusterError || !consolidatorResult)
                        continue;
                    try {
                        // Delete original tickets
                        for (const originalId of consolidatorResult.originalIssueIds) {
                            await deleteTicketFile(resolvedPath, originalId);
                            consolidationSummary.originalTicketsRemoved.push(originalId);
                        }
                        // Create consolidated ticket
                        const ticketResult = await createConsolidatedTicketFile(resolvedPath, consolidatorResult.consolidatedIssue, consolidatorResult.originalIssueIds);
                        // Update issue store
                        await consolidateIssues(resolvedPath, consolidatorResult.originalIssueIds, ticketResult.issue);
                        const newTicketId = extractTicketId(ticketResult.path) ?? 'unknown';
                        // Update status with new ticket ID
                        setClusterStatuses(prev => prev.map(s => s.clusterId === cluster.id
                            ? { ...s, newTicketId }
                            : s));
                        consolidationSummary.clustersProcessed++;
                        consolidationSummary.issuesConsolidated += cluster.issues.length;
                        consolidationSummary.newTicketsCreated.push(newTicketId);
                    }
                    catch (err) {
                        const errorMessage = err instanceof Error ? err.message : 'Unknown error';
                        setClusterStatuses(prev => prev.map(s => s.clusterId === cluster.id
                            ? { ...s, status: 'error', error: `File error: ${errorMessage}` }
                            : s));
                    }
                }
                setResult(consolidationSummary);
                setPhase('complete');
            }
            catch (err) {
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
        return (_jsx(Box, { flexDirection: "column", marginY: 1, children: _jsxs(Text, { color: "red", bold: true, children: ["Error: ", error] }) }));
    }
    if (phase === 'init' || phase === 'loading') {
        return (_jsxs(Box, { marginY: 1, children: [_jsx(Text, { color: "cyan", children: _jsx(Spinner, { type: "dots" }) }), _jsx(Text, { children: " Loading issues..." })] }));
    }
    if (phase === 'clustering') {
        return (_jsx(Box, { flexDirection: "column", marginY: 1, children: _jsxs(Box, { gap: 1, children: [_jsx(Text, { color: "cyan", children: _jsx(Spinner, { type: "dots" }) }), _jsxs(Text, { children: ["Analyzing ", totalIssues, " issues for duplicates..."] })] }) }));
    }
    if (phase === 'applying') {
        return (_jsx(Box, { flexDirection: "column", marginY: 1, children: _jsxs(Box, { gap: 1, children: [_jsx(Text, { color: "cyan", children: _jsx(Spinner, { type: "dots" }) }), _jsx(Text, { children: "Applying file changes..." })] }) }));
    }
    const completedClusters = clusterStatuses.filter(s => s.status === 'complete').length;
    const processingClusters = clusterStatuses.filter(s => s.status === 'processing');
    return (_jsxs(Box, { flexDirection: "column", children: [_jsxs(Box, { borderStyle: "round", borderColor: "cyan", padding: 1, marginBottom: 1, children: [_jsx(Text, { color: "cyan", bold: true, children: "ROVER" }), _jsx(Text, { children: " - Issue Consolidation" }), concurrency > 1 && _jsxs(Text, { dimColor: true, children: [" (", concurrency, " parallel)"] })] }), phase === 'consolidating' && (_jsxs(Box, { flexDirection: "column", marginBottom: 1, children: [_jsxs(Box, { marginBottom: 1, children: [_jsx(Text, { children: "Progress: " }), _jsx(Text, { color: "green", bold: true, children: completedClusters }), _jsxs(Text, { children: ["/", clusterStatuses.length, " clusters processed"] })] }), processingClusters.length > 0 && (_jsx(Box, { flexDirection: "column", paddingLeft: 2, children: processingClusters.map(cluster => (_jsxs(Box, { flexDirection: "column", children: [_jsxs(Box, { gap: 1, children: [_jsx(Text, { color: "cyan", children: _jsx(Spinner, { type: "dots" }) }), _jsx(Text, { children: cluster.reason }), _jsxs(Text, { dimColor: true, children: ["(", cluster.issueCount, " issues)"] })] }), currentMessages.get(cluster.clusterId) && (_jsx(Box, { paddingLeft: 3, children: _jsx(Text, { dimColor: true, children: currentMessages.get(cluster.clusterId) }) }))] }, cluster.clusterId))) })), completedClusters > 0 && (_jsxs(Box, { flexDirection: "column", marginTop: 1, children: [_jsx(Text, { bold: true, dimColor: true, children: "Completed:" }), _jsx(Box, { flexDirection: "column", paddingLeft: 2, children: clusterStatuses.filter(s => s.status === 'complete').map(cluster => (_jsxs(Box, { gap: 1, children: [_jsx(Text, { color: "green", children: "\u2713" }), _jsx(Text, { children: cluster.reason }), _jsxs(Text, { dimColor: true, children: ["(", cluster.issueCount, " issues)"] })] }, cluster.clusterId))) })] }))] })), phase === 'complete' && result && (_jsxs(Box, { flexDirection: "column", children: [_jsx(Box, { borderStyle: "double", borderColor: "green", padding: 1, marginBottom: 1, children: _jsx(Text, { color: "green", bold: true, children: "Consolidation Complete" }) }), result.clustersProcessed === 0 ? (_jsxs(Box, { flexDirection: "column", children: [_jsx(Text, { color: "green", children: "No duplicate issues found!" }), _jsxs(Text, { dimColor: true, children: ["All ", totalIssues, " issues are unique."] })] })) : (_jsxs(Box, { flexDirection: "column", children: [_jsxs(Box, { flexDirection: "column", marginBottom: 1, children: [_jsx(Box, { gap: 2, children: _jsxs(Box, { children: [_jsx(Text, { dimColor: true, children: "Duration: " }), _jsxs(Text, { children: [(result.totalDurationMs / 1000).toFixed(1), "s"] })] }) }), _jsxs(Box, { gap: 2, children: [_jsxs(Box, { children: [_jsx(Text, { dimColor: true, children: "Clusters processed: " }), _jsx(Text, { children: result.clustersProcessed })] }), _jsxs(Box, { children: [_jsx(Text, { dimColor: true, children: "Issues consolidated: " }), _jsx(Text, { color: "yellow", children: result.issuesConsolidated }), _jsx(Text, { children: " \u2192 " }), _jsx(Text, { color: "green", bold: true, children: result.newTicketsCreated.length })] })] })] }), _jsxs(Box, { flexDirection: "column", children: [_jsx(Text, { bold: true, children: "New Consolidated Tickets:" }), _jsx(Box, { flexDirection: "column", paddingLeft: 2, marginTop: 1, children: clusterStatuses.filter(s => s.status === 'complete' && s.newTicketId).map(cluster => (_jsxs(Box, { gap: 1, children: [_jsx(Text, { color: "cyan", children: cluster.newTicketId }), _jsxs(Text, { dimColor: true, children: ["\u2190 ", cluster.reason] })] }, cluster.clusterId))) })] }), result.originalTicketsRemoved.length > 0 && (_jsxs(Box, { marginTop: 1, children: [_jsx(Text, { dimColor: true, children: "Removed original tickets: " }), _jsx(Text, { dimColor: true, children: result.originalTicketsRemoved.join(', ') })] }))] })), result.newTicketsCreated.length > 0 && (_jsxs(Box, { marginTop: 1, children: [_jsx(Text, { dimColor: true, children: "Updated tickets at: " }), _jsxs(Text, { color: "blue", children: [resolvedPath, "/.rover/tickets/"] })] }))] }))] }));
}
