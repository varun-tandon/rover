import type { AgentDefinition } from '../../types/index.js';
/**
 * The Data Fetching Consistency Auditor - Fetch Pattern Analyzer
 *
 * Identifies inconsistent data fetching patterns across the codebase:
 * service functions vs hooks vs direct fetch, React Query vs SWR vs useEffect.
 */
export declare const dataFetchingConsistencyAuditor: AgentDefinition;
