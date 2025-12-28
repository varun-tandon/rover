import React from 'react';
import { Box, Text } from 'ink';
import Spinner from 'ink-spinner';
import type { CheckerStatus } from '../types/index.js';

interface CheckingProgressProps {
  issueCount: number;
  checker: CheckerStatus;
  isComplete: boolean;
}

export function CheckingProgress({
  issueCount,
  checker,
  isComplete
}: CheckingProgressProps) {
  const getStatusIcon = () => {
    switch (checker.status) {
      case 'pending':
        return <Text dimColor>○</Text>;
      case 'checking':
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

  return (
    <Box flexDirection="column" marginY={1}>
      <Box marginBottom={1}>
        <Text bold>Checking Phase</Text>
        <Text> - </Text>
        {isComplete ? (
          <Text color="green">Complete</Text>
        ) : (
          <Text color="cyan">In Progress</Text>
        )}
      </Box>

      <Box marginBottom={1}>
        <Text dimColor>
          {issueCount} issues being validated
        </Text>
      </Box>

      <Box gap={1} paddingLeft={2}>
        {getStatusIcon()}
        <Text color={getStatusColor()}>
          Checker:
        </Text>
        <Text>
          {checker.issuesChecked}/{checker.totalIssues} checked
        </Text>
        {checker.status === 'completed' && (
          <Text dimColor> (done)</Text>
        )}
      </Box>

      {isComplete && (
        <Box marginTop={1}>
          <Text color="green">✓ </Text>
          <Text>All issues have been validated.</Text>
        </Box>
      )}
    </Box>
  );
}
