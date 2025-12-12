import React from 'react';
import { Box, Text } from 'ink';
import Spinner from 'ink-spinner';
import type { VoterStatus } from '../types/index.js';

interface VoterRowProps {
  voter: VoterStatus;
}

function VoterRow({ voter }: VoterRowProps) {
  const getStatusIcon = () => {
    switch (voter.status) {
      case 'pending':
        return <Text dimColor>○</Text>;
      case 'voting':
        return (
          <Text color="cyan">
            <Spinner type="dots" />
          </Text>
        );
      case 'completed':
        return <Text color="green">✓</Text>;
      case 'error':
        return <Text color="red">✗</Text>;
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

  return (
    <Box gap={1}>
      {getStatusIcon()}
      <Text color={getStatusColor()}>
        {voter.id}:
      </Text>
      <Text>
        {voter.votesCompleted}/{voter.totalVotes} votes
      </Text>
      {voter.status === 'completed' && (
        <Text dimColor> (done)</Text>
      )}
    </Box>
  );
}

interface VotingProgressProps {
  issueCount: number;
  voters: VoterStatus[];
  isComplete: boolean;
}

export function VotingProgress({
  issueCount,
  voters,
  isComplete
}: VotingProgressProps) {
  const completedVoters = voters.filter(v => v.status === 'completed').length;

  return (
    <Box flexDirection="column" marginY={1}>
      <Box marginBottom={1}>
        <Text bold>Voting Phase</Text>
        <Text> - </Text>
        {isComplete ? (
          <Text color="green">Complete</Text>
        ) : (
          <Text color="cyan">In Progress</Text>
        )}
      </Box>

      <Box marginBottom={1}>
        <Text dimColor>
          {issueCount} issues being evaluated by {voters.length} independent voters
        </Text>
      </Box>

      <Box flexDirection="column" paddingLeft={2}>
        {voters.map(voter => (
          <VoterRow key={voter.id} voter={voter} />
        ))}
      </Box>

      {isComplete && (
        <Box marginTop={1}>
          <Text color="green">✓ </Text>
          <Text>All {completedVoters} voters have completed their evaluation.</Text>
        </Box>
      )}
    </Box>
  );
}
