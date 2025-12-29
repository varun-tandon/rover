/**
 * Validation checks (typecheck, build, lint) for the fix workflow
 */
import type { ValidationResult } from './types.js';
/**
 * Run all validation checks (typecheck, build, lint)
 * Returns a ValidationResult with pass/fail status for each check
 */
export declare function runValidation(worktreePath: string, verbose?: boolean): Promise<ValidationResult>;
/**
 * Check if validation passed (all checks passed)
 */
export declare function validationPassed(validation: ValidationResult): boolean;
/**
 * Format validation errors into a readable message for Claude
 */
export declare function formatValidationErrors(validation: ValidationResult): string;
