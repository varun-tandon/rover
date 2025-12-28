/**
 * Plan storage utilities for work planning feature.
 * Saves work plans with Mermaid diagrams to .rover/plans/
 */
import type { ApprovedIssue, WorkPlan, DependencyAnalysis } from '../types/index.js';
/**
 * Get the plans directory path
 */
export declare function getPlansDir(targetPath: string): string;
/**
 * Ensure the plans directory exists
 */
export declare function ensurePlansDir(targetPath: string): Promise<void>;
/**
 * Generate a plan filename with timestamp
 */
export declare function generatePlanFilename(): string;
/**
 * Generate a Mermaid flowchart diagram from issues and dependency analysis
 */
export declare function generateMermaidDiagram(issues: ApprovedIssue[], analysis: DependencyAnalysis): string;
/**
 * Build a complete work plan from issues and analysis
 */
export declare function buildWorkPlan(issues: ApprovedIssue[], analysis: DependencyAnalysis): WorkPlan;
/**
 * Save a work plan to the plans directory
 * Returns the path to the saved file
 */
export declare function savePlan(targetPath: string, plan: WorkPlan): Promise<string>;
