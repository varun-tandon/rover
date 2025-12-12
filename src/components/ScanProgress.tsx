import React from 'react';
import { Box, Text } from 'ink';
import Spinner from 'ink-spinner';

interface ScanProgressProps {
  agentName: string;
  targetPath: string;
  message: string;
  isComplete: boolean;
  issueCount?: number;
}

export function ScanProgress({
  agentName,
  targetPath,
  message,
  isComplete,
  issueCount
}: ScanProgressProps) {
  return (
    <Box flexDirection="column" marginY={1}>
      <Box>
        <Text color="cyan" bold>Scanning with: </Text>
        <Text>{agentName}</Text>
      </Box>

      <Box>
        <Text dimColor>Target: </Text>
        <Text dimColor>{targetPath}</Text>
      </Box>

      <Box marginTop={1}>
        {isComplete ? (
          <Box>
            <Text color="green">✓ </Text>
            <Text>Scan complete. Found </Text>
            <Text color="yellow" bold>{issueCount ?? 0}</Text>
            <Text> candidate issues.</Text>
          </Box>
        ) : (
          <Box>
            <Text color="cyan">
              <Spinner type="dots" />
            </Text>
            <Text> {message}</Text>
          </Box>
        )}
      </Box>
    </Box>
  );
}
