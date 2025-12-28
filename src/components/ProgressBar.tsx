import React from 'react';
import { Text } from 'ink';

interface ProgressBarProps {
  current: number;
  total: number;
  width?: number;
}

export function ProgressBar({ current, total, width = 10 }: ProgressBarProps) {
  const percent = total > 0 ? current / total : 0;
  const filled = Math.round(percent * width);
  const empty = width - filled;

  return (
    <Text>
      [<Text color="green">{'█'.repeat(filled)}</Text>
      <Text dimColor>{'░'.repeat(empty)}</Text>]
      {' '}{Math.round(percent * 100)}% ({current}/{total})
    </Text>
  );
}
