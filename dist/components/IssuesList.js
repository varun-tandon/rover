import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { useState, useEffect } from 'react';
import { Box, Text, useApp } from 'ink';
import { loadIssueStore } from '../storage/issues.js';
import { extractTicketId } from '../storage/tickets.js';
const SEVERITY_ORDER = ['critical', 'high', 'medium', 'low'];
function getSeverityColor(severity) {
    switch (severity) {
        case 'critical':
            return 'red';
        case 'high':
            return 'yellow';
        case 'medium':
            return 'cyan';
        case 'low':
            return 'gray';
        default:
            return 'white';
    }
}
function IssueRow({ issue }) {
    const ticketId = extractTicketId(issue.ticketPath);
    const isIgnored = issue.status === 'wont_fix';
    return (_jsxs(Box, { paddingLeft: 2, children: [_jsx(Text, { children: "\u2022 " }), ticketId && _jsx(Text, { color: isIgnored ? 'gray' : 'cyan', children: ticketId }), ticketId && _jsx(Text, { children: ": " }), _jsx(Text, { bold: !isIgnored, dimColor: isIgnored, children: issue.title }), isIgnored && _jsx(Text, { color: "gray", children: " [ignored]" }), _jsxs(Text, { dimColor: true, children: [" (", issue.filePath] }), issue.lineRange && (_jsxs(Text, { dimColor: true, children: [":", issue.lineRange.start, "-", issue.lineRange.end] })), _jsx(Text, { dimColor: true, children: ")" })] }));
}
function SeverityGroup({ severity, issues }) {
    if (issues.length === 0)
        return null;
    const color = getSeverityColor(severity);
    return (_jsxs(Box, { flexDirection: "column", marginBottom: 1, children: [_jsxs(Box, { children: [_jsxs(Text, { color: color, bold: true, children: ["[", severity.toUpperCase(), "]"] }), _jsxs(Text, { dimColor: true, children: [" (", issues.length, " issue", issues.length !== 1 ? 's' : '', ")"] })] }), issues.map(issue => (_jsx(IssueRow, { issue: issue }, issue.id)))] }));
}
export function IssuesList({ targetPath, severityFilter, showIgnored }) {
    const { exit } = useApp();
    const [store, setStore] = useState(null);
    const [error, setError] = useState(null);
    useEffect(() => {
        loadIssueStore(targetPath)
            .then(setStore)
            .catch(err => setError(err.message));
    }, [targetPath]);
    useEffect(() => {
        if (store !== null || error !== null) {
            const timer = setTimeout(() => exit(), 100);
            return () => clearTimeout(timer);
        }
    }, [store, error, exit]);
    if (error) {
        return _jsxs(Text, { color: "red", children: ["Error: ", error] });
    }
    if (!store) {
        return _jsx(Text, { dimColor: true, children: "Loading issues..." });
    }
    // Filter by severity if filter provided
    let issues = store.issues;
    // Filter out ignored issues unless showIgnored is true
    if (!showIgnored) {
        issues = issues.filter(i => i.status !== 'wont_fix');
    }
    if (severityFilter && severityFilter.length > 0) {
        issues = issues.filter(i => severityFilter.includes(i.severity));
    }
    // Count ignored issues for display
    const ignoredCount = store.issues.filter(i => i.status === 'wont_fix').length;
    // Group by severity
    const grouped = new Map();
    for (const sev of SEVERITY_ORDER) {
        grouped.set(sev, issues.filter(i => i.severity === sev));
    }
    // Build severity counts for summary
    const severityCounts = SEVERITY_ORDER
        .map(sev => {
        const count = grouped.get(sev)?.length ?? 0;
        return count > 0 ? `${count} ${sev}` : null;
    })
        .filter(Boolean);
    return (_jsxs(Box, { flexDirection: "column", marginY: 1, children: [_jsxs(Box, { marginBottom: 1, children: [_jsx(Text, { bold: true, children: "Stored Issues" }), severityFilter && severityFilter.length > 0 && (_jsxs(Text, { dimColor: true, children: [" (filtered: ", severityFilter.join(', '), ")"] }))] }), _jsxs(Box, { marginBottom: 1, gap: 1, children: [_jsx(Text, { dimColor: true, children: "Total:" }), _jsx(Text, { bold: true, children: issues.length }), severityCounts.length > 0 && (_jsxs(Text, { dimColor: true, children: ["(", severityCounts.join(', '), ")"] }))] }), store.lastScanAt && (_jsxs(Box, { marginBottom: 1, children: [_jsx(Text, { dimColor: true, children: "Last scan: " }), _jsx(Text, { children: new Date(store.lastScanAt).toLocaleString() })] })), issues.length === 0 ? (_jsxs(Text, { dimColor: true, children: ["No issues found", severityFilter && severityFilter.length > 0 ? ' matching filter' : '', "."] })) : (_jsx(Box, { flexDirection: "column", marginTop: 1, children: SEVERITY_ORDER.map(sev => (_jsx(SeverityGroup, { severity: sev, issues: grouped.get(sev) ?? [] }, sev))) })), !showIgnored && ignoredCount > 0 && (_jsx(Box, { marginTop: 1, children: _jsxs(Text, { dimColor: true, children: ["(", ignoredCount, " ignored issue", ignoredCount !== 1 ? 's' : '', " hidden. Use --all to show.)"] }) }))] }));
}
