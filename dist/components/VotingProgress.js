import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { Box, Text } from 'ink';
import Spinner from 'ink-spinner';
function VoterRow({ voter }) {
    const getStatusIcon = () => {
        switch (voter.status) {
            case 'pending':
                return _jsx(Text, { dimColor: true, children: "\u25CB" });
            case 'voting':
                return (_jsx(Text, { color: "cyan", children: _jsx(Spinner, { type: "dots" }) }));
            case 'completed':
                return _jsx(Text, { color: "green", children: "\u2713" });
            case 'error':
                return _jsx(Text, { color: "red", children: "\u2717" });
        }
    };
    const getStatusColor = () => {
        switch (voter.status) {
            case 'pending':
                return 'gray';
            case 'voting':
                return 'cyan';
            case 'completed':
                return 'green';
            case 'error':
                return 'red';
        }
    };
    return (_jsxs(Box, { gap: 1, children: [getStatusIcon(), _jsxs(Text, { color: getStatusColor(), children: [voter.id, ":"] }), _jsxs(Text, { children: [voter.votesCompleted, "/", voter.totalVotes, " votes"] }), voter.status === 'completed' && (_jsx(Text, { dimColor: true, children: " (done)" }))] }));
}
export function VotingProgress({ issueCount, voters, isComplete }) {
    const completedVoters = voters.filter(v => v.status === 'completed').length;
    return (_jsxs(Box, { flexDirection: "column", marginY: 1, children: [_jsxs(Box, { marginBottom: 1, children: [_jsx(Text, { bold: true, children: "Voting Phase" }), _jsx(Text, { children: " - " }), isComplete ? (_jsx(Text, { color: "green", children: "Complete" })) : (_jsx(Text, { color: "cyan", children: "In Progress" }))] }), _jsx(Box, { marginBottom: 1, children: _jsxs(Text, { dimColor: true, children: [issueCount, " issues being evaluated by ", voters.length, " independent voters"] }) }), _jsx(Box, { flexDirection: "column", paddingLeft: 2, children: voters.map(voter => (_jsx(VoterRow, { voter: voter }, voter.id))) }), isComplete && (_jsxs(Box, { marginTop: 1, children: [_jsx(Text, { color: "green", children: "\u2713 " }), _jsxs(Text, { children: ["All ", completedVoters, " voters have completed their evaluation."] })] }))] }));
}
