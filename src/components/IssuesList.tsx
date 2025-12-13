import React, { useState, useEffect } from 'react';
import { Box, Text, useApp } from 'ink';
import { loadIssueStore } from '../storage/issues.js';
import type { ApprovedIssue, IssueSeverity, IssueStore } from '../types/index.js';

const SEVERITY_ORDER: IssueSeverity[] = ['critical', 'high', 'medium', 'low'];

function getSeverityColor(severity: string) {
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
}

interface IssueRowProps {
  issue: ApprovedIssue;
}

function IssueRow({ issue }: IssueRowProps) {
  return (
    <Box paddingLeft={2}>
      <Text>• </Text>
      <Text bold>{issue.title}</Text>
      <Text dimColor> ({issue.filePath}</Text>
      {issue.lineRange && (
        <Text dimColor>:{issue.lineRange.start}-{issue.lineRange.end}</Text>
      )}
      <Text dimColor>)</Text>
    </Box>
  );
}

interface SeverityGroupProps {
  severity: IssueSeverity;
  issues: ApprovedIssue[];
}

function SeverityGroup({ severity, issues }: SeverityGroupProps) {
  if (issues.length === 0) return null;

  const color = getSeverityColor(severity);

  return (
    <Box flexDirection="column" marginBottom={1}>
      <Box>
        <Text color={color} bold>
          [{severity.toUpperCase()}]
        </Text>
        <Text dimColor> ({issues.length} issue{issues.length !== 1 ? 's' : ''})</Text>
      </Box>
      {issues.map(issue => (
        <IssueRow key={issue.id} issue={issue} />
      ))}
    </Box>
  );
}

interface IssuesListProps {
  targetPath: string;
  severityFilter?: string[];
}

export function IssuesList({ targetPath, severityFilter }: IssuesListProps) {
  const { exit } = useApp();
  const [store, setStore] = useState<IssueStore | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    loadIssueStore(targetPath)
      .then(setStore)
      .catch(err => setError(err.message));
  }, [targetPath]);

  useEffect(() => {
    if (store !== null || error !== null) {
      const timer = setTimeout(() => exit(), 100);
      return () => clearTimeout(timer);
    }
  }, [store, error, exit]);

  if (error) {
    return <Text color="red">Error: {error}</Text>;
  }

  if (!store) {
    return <Text dimColor>Loading issues...</Text>;
  }

  // Filter by severity if filter provided
  let issues = store.issues;
  if (severityFilter && severityFilter.length > 0) {
    issues = issues.filter(i => severityFilter.includes(i.severity));
  }

  // Group by severity
  const grouped = new Map<IssueSeverity, ApprovedIssue[]>();
  for (const sev of SEVERITY_ORDER) {
    grouped.set(sev, issues.filter(i => i.severity === sev));
  }

  // Build severity counts for summary
  const severityCounts = SEVERITY_ORDER
    .map(sev => {
      const count = grouped.get(sev)?.length ?? 0;
      return count > 0 ? `${count} ${sev}` : null;
    })
    .filter(Boolean);

  return (
    <Box flexDirection="column" marginY={1}>
      {/* Header */}
      <Box marginBottom={1}>
        <Text bold>Stored Issues</Text>
        {severityFilter && severityFilter.length > 0 && (
          <Text dimColor> (filtered: {severityFilter.join(', ')})</Text>
        )}
      </Box>

      {/* Summary */}
      <Box marginBottom={1} gap={1}>
        <Text dimColor>Total:</Text>
        <Text bold>{issues.length}</Text>
        {severityCounts.length > 0 && (
          <Text dimColor>({severityCounts.join(', ')})</Text>
        )}
      </Box>

      {store.lastScanAt && (
        <Box marginBottom={1}>
          <Text dimColor>Last scan: </Text>
          <Text>{new Date(store.lastScanAt).toLocaleString()}</Text>
        </Box>
      )}

      {/* Grouped issues */}
      {issues.length === 0 ? (
        <Text dimColor>
          No issues found{severityFilter && severityFilter.length > 0 ? ' matching filter' : ''}.
        </Text>
      ) : (
        <Box flexDirection="column" marginTop={1}>
          {SEVERITY_ORDER.map(sev => (
            <SeverityGroup
              key={sev}
              severity={sev}
              issues={grouped.get(sev) ?? []}
            />
          ))}
        </Box>
      )}
    </Box>
  );
}
