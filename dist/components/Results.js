import { jsxs as _jsxs, jsx as _jsx } from "react/jsx-runtime";
import { Box, Text } from 'ink';
function IssueCard({ issue, ticketPath }) {
    const getSeverityColor = (severity) => {
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
    };
    return (_jsxs(Box, { flexDirection: "column", borderStyle: "round", borderColor: "gray", padding: 1, marginBottom: 1, children: [_jsxs(Box, { gap: 1, children: [_jsxs(Text, { color: getSeverityColor(issue.severity), bold: true, children: ["[", issue.severity.toUpperCase(), "]"] }), _jsx(Text, { bold: true, children: issue.title })] }), _jsxs(Box, { marginTop: 1, children: [_jsx(Text, { dimColor: true, children: "Category: " }), _jsx(Text, { children: issue.category })] }), _jsxs(Box, { children: [_jsx(Text, { dimColor: true, children: "File: " }), _jsx(Text, { color: "cyan", children: issue.filePath }), issue.lineRange && (_jsxs(Text, { dimColor: true, children: [":", issue.lineRange.start, "-", issue.lineRange.end] }))] }), _jsxs(Box, { children: [_jsx(Text, { dimColor: true, children: "Ticket: " }), _jsx(Text, { color: "blue", children: ticketPath })] })] }));
}
function RejectedIssue({ issue }) {
    return (_jsxs(Box, { gap: 1, children: [_jsx(Text, { dimColor: true, children: "\u2717" }), _jsx(Text, { dimColor: true, children: issue.title }), _jsxs(Text, { dimColor: true, children: ["(", issue.filePath, ")"] })] }));
}
export function Results({ approvedIssues, rejectedIssues, ticketPaths, durationMs, totalCost }) {
    const durationSec = (durationMs / 1000).toFixed(1);
    return (_jsxs(Box, { flexDirection: "column", marginY: 1, children: [_jsx(Box, { borderStyle: "double", borderColor: "green", padding: 1, marginBottom: 1, children: _jsx(Text, { color: "green", bold: true, children: "Scan Complete" }) }), _jsxs(Box, { flexDirection: "column", marginBottom: 1, children: [_jsxs(Box, { gap: 2, children: [_jsxs(Box, { children: [_jsx(Text, { dimColor: true, children: "Duration: " }), _jsxs(Text, { children: [durationSec, "s"] })] }), _jsxs(Box, { children: [_jsx(Text, { dimColor: true, children: "Cost: " }), _jsxs(Text, { children: ["$", totalCost.toFixed(4)] })] })] }), _jsxs(Box, { gap: 2, children: [_jsxs(Box, { children: [_jsx(Text, { dimColor: true, children: "Approved: " }), _jsx(Text, { color: "green", bold: true, children: approvedIssues.length })] }), _jsxs(Box, { children: [_jsx(Text, { dimColor: true, children: "Rejected: " }), _jsx(Text, { color: "red", children: rejectedIssues.length })] }), _jsxs(Box, { children: [_jsx(Text, { dimColor: true, children: "Tickets: " }), _jsx(Text, { color: "cyan", children: ticketPaths.length })] })] })] }), approvedIssues.length > 0 && (_jsxs(Box, { flexDirection: "column", marginBottom: 1, children: [_jsxs(Text, { bold: true, color: "green", children: ["Approved Issues (", approvedIssues.length, ")"] }), _jsx(Box, { flexDirection: "column", marginTop: 1, children: approvedIssues.map((issue, i) => (_jsx(IssueCard, { issue: issue, ticketPath: ticketPaths[i] ?? issue.ticketPath }, issue.id))) })] })), rejectedIssues.length > 0 && (_jsxs(Box, { flexDirection: "column", children: [_jsxs(Text, { bold: true, dimColor: true, children: ["Rejected Issues (", rejectedIssues.length, ")"] }), _jsx(Box, { flexDirection: "column", paddingLeft: 2, marginTop: 1, children: rejectedIssues.map(issue => (_jsx(RejectedIssue, { issue: issue }, issue.id))) })] })), approvedIssues.length === 0 && rejectedIssues.length === 0 && (_jsx(Box, { children: _jsx(Text, { color: "green", children: "\u2713 No issues found! Your codebase looks clean." }) }))] }));
}
