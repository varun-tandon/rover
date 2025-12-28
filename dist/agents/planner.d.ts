/**
 * Planner agent for analyzing issue dependencies and creating work plans.
 * Uses an LLM to infer logical dependencies between issues.
 */
import type { ApprovedIssue, DependencyAnalysis } from '../types/index.js';
/**
 * Options for running the planner
 */
export interface PlannerOptions {
    /** Target directory containing the code */
    targetPath: string;
    /** Issues to analyze for dependencies */
    issues: ApprovedIssue[];
    /** Callback for progress updates */
    onProgress?: (message: string) => void;
}
/**
 * Result from the planner
 */
export interface PlannerResult {
    /** The dependency analysis */
    analysis: DependencyAnalysis;
    /** Duration in milliseconds */
    durationMs: number;
}
/**
 * Run the planner agent to analyze dependencies between issues.
 */
export declare function runPlanner(options: PlannerOptions): Promise<PlannerResult>;
