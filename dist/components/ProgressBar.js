import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { Text } from 'ink';
export function ProgressBar({ current, total, width = 10 }) {
    const percent = total > 0 ? current / total : 0;
    const filled = Math.round(percent * width);
    const empty = width - filled;
    return (_jsxs(Text, { children: ["[", _jsx(Text, { color: "green", children: '█'.repeat(filled) }), _jsx(Text, { dimColor: true, children: '░'.repeat(empty) }), "]", ' ', Math.round(percent * 100), "% (", current, "/", total, ")"] }));
}
