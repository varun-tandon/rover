import type { AgentDefinition } from '../../types/index.js';
/**
 * The State Duplication Auditor - Cross-System State Sync Analyzer
 *
 * Identifies state stored in multiple places (React Query + localStorage,
 * Context + component state, etc.) that can get out of sync.
 */
export declare const stateDuplicationAuditor: AgentDefinition;
