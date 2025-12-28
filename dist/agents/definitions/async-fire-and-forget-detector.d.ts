import type { AgentDefinition } from '../../types/index.js';
/**
 * The Async Fire-and-Forget Detector - Promise Error Swallower Finder
 *
 * Identifies promises that silently swallow errors, making debugging
 * impossible and causing silent failures in production.
 */
export declare const asyncFireAndForgetDetector: AgentDefinition;
