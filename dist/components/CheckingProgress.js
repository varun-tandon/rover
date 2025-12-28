import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { Box, Text } from 'ink';
import Spinner from 'ink-spinner';
export function CheckingProgress({ issueCount, checker, isComplete }) {
    const getStatusIcon = () => {
        switch (checker.status) {
            case 'pending':
                return _jsx(Text, { dimColor: true, children: "\u25CB" });
            case 'checking':
                return (_jsx(Text, { color: "cyan", children: _jsx(Spinner, { type: "dots" }) }));
            case 'completed':
                return _jsx(Text, { color: "green", children: "\u2713" });
            case 'error':
                return _jsx(Text, { color: "red", children: "\u2717" });
        }
    };
    const getStatusColor = () => {
        switch (checker.status) {
            case 'pending':
                return 'gray';
            case 'checking':
                return 'cyan';
            case 'completed':
                return 'green';
            case 'error':
                return 'red';
        }
    };
    return (_jsxs(Box, { flexDirection: "column", marginY: 1, children: [_jsxs(Box, { marginBottom: 1, children: [_jsx(Text, { bold: true, children: "Checking Phase" }), _jsx(Text, { children: " - " }), isComplete ? (_jsx(Text, { color: "green", children: "Complete" })) : (_jsx(Text, { color: "cyan", children: "In Progress" }))] }), _jsx(Box, { marginBottom: 1, children: _jsxs(Text, { dimColor: true, children: [issueCount, " issues being validated"] }) }), _jsxs(Box, { gap: 1, paddingLeft: 2, children: [getStatusIcon(), _jsx(Text, { color: getStatusColor(), children: "Checker:" }), _jsxs(Text, { children: [checker.issuesChecked, "/", checker.totalIssues, " checked"] }), checker.status === 'completed' && (_jsx(Text, { dimColor: true, children: " (done)" }))] }), isComplete && (_jsxs(Box, { marginTop: 1, children: [_jsx(Text, { color: "green", children: "\u2713 " }), _jsx(Text, { children: "All issues have been validated." })] }))] }));
}
