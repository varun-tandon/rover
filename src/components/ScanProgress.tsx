import React from 'react';
import { Box, Text } from 'ink';
import Spinner from 'ink-spinner';

interface ScanProgressProps {
  agentName: string;
  targetPath: string;
  message: string;
  isComplete: boolean;
  issueCount?: number;
  costUsd?: number;
}

/**
 * Format cost for display, showing appropriate precision
 */
function formatCost(costUsd: number): string {
  if (costUsd < 0.01) {
    return `$${costUsd.toFixed(4)}`;
  }
  return `$${costUsd.toFixed(2)}`;
}

export function ScanProgress({
  agentName,
  targetPath,
  message,
  isComplete,
  issueCount,
  costUsd
}: ScanProgressProps) {
  return (
    <Box flexDirection="column" marginY={1}>
      <Box>
        <Text color="cyan" bold>Scanning with: </Text>
        <Text>{agentName}</Text>
        {costUsd !== undefined && costUsd > 0 && (
          <>
            <Text dimColor>  •  </Text>
            <Text color="yellow">{formatCost(costUsd)}</Text>
          </>
        )}
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
