import React from 'react';
import { Box, Text } from 'ink';
import type { ApprovedIssue, CandidateIssue } from '../types/index.js';
import { countApprovals } from '../utils/votes.js';

interface IssueCardProps {
  issue: ApprovedIssue;
  ticketPath: string;
}

function IssueCard({ issue, ticketPath }: IssueCardProps) {
  const getSeverityColor = (severity: string) => {
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

  const voteCount = countApprovals(issue.votes);

  return (
    <Box flexDirection="column" borderStyle="round" borderColor="gray" padding={1} marginBottom={1}>
      <Box gap={1}>
        <Text color={getSeverityColor(issue.severity)} bold>
          [{issue.severity.toUpperCase()}]
        </Text>
        <Text bold>{issue.title}</Text>
      </Box>

      <Box marginTop={1}>
        <Text dimColor>Category: </Text>
        <Text>{issue.category}</Text>
      </Box>

      <Box>
        <Text dimColor>File: </Text>
        <Text color="cyan">{issue.filePath}</Text>
        {issue.lineRange && (
          <Text dimColor>:{issue.lineRange.start}-{issue.lineRange.end}</Text>
        )}
      </Box>

      <Box>
        <Text dimColor>Votes: </Text>
        <Text color="green">{voteCount}/3 approved</Text>
      </Box>

      <Box>
        <Text dimColor>Ticket: </Text>
        <Text color="blue">{ticketPath}</Text>
      </Box>
    </Box>
  );
}

interface RejectedIssueProps {
  issue: CandidateIssue;
}

function RejectedIssue({ issue }: RejectedIssueProps) {
  return (
    <Box gap={1}>
      <Text dimColor>✗</Text>
      <Text dimColor>{issue.title}</Text>
      <Text dimColor>({issue.filePath})</Text>
    </Box>
  );
}

interface ResultsProps {
  approvedIssues: ApprovedIssue[];
  rejectedIssues: CandidateIssue[];
  ticketPaths: string[];
  durationMs: number;
  totalCost: number;
}

export function Results({
  approvedIssues,
  rejectedIssues,
  ticketPaths,
  durationMs,
  totalCost
}: ResultsProps) {
  const durationSec = (durationMs / 1000).toFixed(1);

  return (
    <Box flexDirection="column" marginY={1}>
      <Box borderStyle="double" borderColor="green" padding={1} marginBottom={1}>
        <Text color="green" bold>Scan Complete</Text>
      </Box>

      {/* Summary stats */}
      <Box flexDirection="column" marginBottom={1}>
        <Box gap={2}>
          <Box>
            <Text dimColor>Duration: </Text>
            <Text>{durationSec}s</Text>
          </Box>
          <Box>
            <Text dimColor>Cost: </Text>
            <Text>${totalCost.toFixed(4)}</Text>
          </Box>
        </Box>

        <Box gap={2}>
          <Box>
            <Text dimColor>Approved: </Text>
            <Text color="green" bold>{approvedIssues.length}</Text>
          </Box>
          <Box>
            <Text dimColor>Rejected: </Text>
            <Text color="red">{rejectedIssues.length}</Text>
          </Box>
          <Box>
            <Text dimColor>Tickets: </Text>
            <Text color="cyan">{ticketPaths.length}</Text>
          </Box>
        </Box>
      </Box>

      {/* Approved issues */}
      {approvedIssues.length > 0 && (
        <Box flexDirection="column" marginBottom={1}>
          <Text bold color="green">Approved Issues ({approvedIssues.length})</Text>
          <Box flexDirection="column" marginTop={1}>
            {approvedIssues.map((issue, i) => (
              <IssueCard
                key={issue.id}
                issue={issue}
                ticketPath={ticketPaths[i] ?? issue.ticketPath}
              />
            ))}
          </Box>
        </Box>
      )}

      {/* Rejected issues */}
      {rejectedIssues.length > 0 && (
        <Box flexDirection="column">
          <Text bold dimColor>Rejected Issues ({rejectedIssues.length})</Text>
          <Box flexDirection="column" paddingLeft={2} marginTop={1}>
            {rejectedIssues.map(issue => (
              <RejectedIssue key={issue.id} issue={issue} />
            ))}
          </Box>
        </Box>
      )}

      {/* No issues message */}
      {approvedIssues.length === 0 && rejectedIssues.length === 0 && (
        <Box>
          <Text color="green">✓ No issues found! Your codebase looks clean.</Text>
        </Box>
      )}
    </Box>
  );
}
