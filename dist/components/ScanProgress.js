import { jsx as _jsx, Fragment as _Fragment, jsxs as _jsxs } from "react/jsx-runtime";
import { Box, Text } from 'ink';
import Spinner from 'ink-spinner';
/**
 * Format cost for display, showing appropriate precision
 */
function formatCost(costUsd) {
    if (costUsd < 0.01) {
        return `$${costUsd.toFixed(4)}`;
    }
    return `$${costUsd.toFixed(2)}`;
}
export function ScanProgress({ agentName, targetPath, message, isComplete, issueCount, costUsd }) {
    return (_jsxs(Box, { flexDirection: "column", marginY: 1, children: [_jsxs(Box, { children: [_jsx(Text, { color: "cyan", bold: true, children: "Scanning with: " }), _jsx(Text, { children: agentName }), costUsd !== undefined && costUsd > 0 && (_jsxs(_Fragment, { children: [_jsx(Text, { dimColor: true, children: "  \u2022  " }), _jsx(Text, { color: "yellow", children: formatCost(costUsd) })] }))] }), _jsxs(Box, { children: [_jsx(Text, { dimColor: true, children: "Target: " }), _jsx(Text, { dimColor: true, children: targetPath })] }), _jsx(Box, { marginTop: 1, children: isComplete ? (_jsxs(Box, { children: [_jsx(Text, { color: "green", children: "\u2713 " }), _jsx(Text, { children: "Scan complete. Found " }), _jsx(Text, { color: "yellow", bold: true, children: issueCount ?? 0 }), _jsx(Text, { children: " candidate issues." })] })) : (_jsxs(Box, { children: [_jsx(Text, { color: "cyan", children: _jsx(Spinner, { type: "dots" }) }), _jsxs(Text, { children: [" ", message] })] })) })] }));
}
