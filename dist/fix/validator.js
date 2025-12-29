/**
 * Validation checks (typecheck, build, lint) for the fix workflow
 */
import { spawn } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
/**
 * Run a command and return stdout, stderr, and exit code
 */
async function runCommand(command, args, cwd) {
    return new Promise((resolve) => {
        const child = spawn(command, args, {
            cwd,
            env: process.env,
            stdio: ['ignore', 'pipe', 'pipe'],
        });
        let stdout = '';
        let stderr = '';
        child.stdout.on('data', (data) => {
            stdout += data.toString();
        });
        child.stderr.on('data', (data) => {
            stderr += data.toString();
        });
        child.on('close', (code) => {
            resolve({
                stdout,
                stderr,
                exitCode: code ?? 0,
            });
        });
        child.on('error', (err) => {
            resolve({
                stdout,
                stderr: err.message,
                exitCode: 1,
            });
        });
    });
}
/**
 * Check if a package.json script exists
 */
async function hasScript(worktreePath, scriptName) {
    try {
        const packageJsonPath = join(worktreePath, 'package.json');
        const packageJson = await readFile(packageJsonPath, 'utf-8');
        const parsed = JSON.parse(packageJson);
        return Boolean(parsed.scripts?.[scriptName]);
    }
    catch {
        return false;
    }
}
/**
 * Detect the package manager (pnpm, npm, yarn, bun)
 */
async function detectPackageManager(worktreePath) {
    try {
        const packageJsonPath = join(worktreePath, 'package.json');
        const packageJson = await readFile(packageJsonPath, 'utf-8');
        const parsed = JSON.parse(packageJson);
        // If packageManager field is set (e.g., "pnpm@10.12.4"), extract the name
        if (parsed.packageManager) {
            const manager = parsed.packageManager.split('@')[0];
            if (manager) {
                return manager;
            }
        }
    }
    catch {
        // Fall through to default
    }
    // Default to pnpm
    return 'pnpm';
}
/**
 * Run all validation checks (typecheck, build, lint)
 * Returns a ValidationResult with pass/fail status for each check
 */
export async function runValidation(worktreePath, verbose = false) {
    const packageManager = await detectPackageManager(worktreePath);
    // Check which scripts exist
    const [hasTypecheck, hasBuild, hasLint] = await Promise.all([
        hasScript(worktreePath, 'typecheck'),
        hasScript(worktreePath, 'build'),
        hasScript(worktreePath, 'lint'),
    ]);
    const result = {
        typecheckPassed: true,
        buildPassed: true,
        lintPassed: true,
    };
    // Run typecheck if available
    if (hasTypecheck) {
        if (verbose) {
            console.log('[validation] Running typecheck...');
        }
        const typecheckResult = await runCommand(packageManager, ['run', 'typecheck'], worktreePath);
        result.typecheckPassed = typecheckResult.exitCode === 0;
        if (!result.typecheckPassed) {
            result.typecheckOutput = `Exit code: ${typecheckResult.exitCode}\n\nSTDOUT:\n${typecheckResult.stdout}\n\nSTDERR:\n${typecheckResult.stderr}`;
            if (verbose) {
                console.log('[validation] Typecheck failed:', result.typecheckOutput);
            }
        }
        else if (verbose) {
            console.log('[validation] Typecheck passed');
        }
    }
    // Run build if available
    if (hasBuild) {
        if (verbose) {
            console.log('[validation] Running build...');
        }
        const buildResult = await runCommand(packageManager, ['run', 'build'], worktreePath);
        result.buildPassed = buildResult.exitCode === 0;
        if (!result.buildPassed) {
            result.buildOutput = `Exit code: ${buildResult.exitCode}\n\nSTDOUT:\n${buildResult.stdout}\n\nSTDERR:\n${buildResult.stderr}`;
            if (verbose) {
                console.log('[validation] Build failed:', result.buildOutput);
            }
        }
        else if (verbose) {
            console.log('[validation] Build passed');
        }
    }
    // Run lint if available
    if (hasLint) {
        if (verbose) {
            console.log('[validation] Running lint...');
        }
        const lintResult = await runCommand(packageManager, ['run', 'lint'], worktreePath);
        result.lintPassed = lintResult.exitCode === 0;
        if (!result.lintPassed) {
            result.lintOutput = `Exit code: ${lintResult.exitCode}\n\nSTDOUT:\n${lintResult.stdout}\n\nSTDERR:\n${lintResult.stderr}`;
            if (verbose) {
                console.log('[validation] Lint failed:', result.lintOutput);
            }
        }
        else if (verbose) {
            console.log('[validation] Lint passed');
        }
    }
    return result;
}
/**
 * Check if validation passed (all checks passed)
 */
export function validationPassed(validation) {
    return validation.typecheckPassed && validation.buildPassed && validation.lintPassed;
}
/**
 * Format validation errors into a readable message for Claude
 */
export function formatValidationErrors(validation) {
    const errors = [];
    if (!validation.typecheckPassed && validation.typecheckOutput) {
        errors.push(`TYPECHECK ERRORS:\n${validation.typecheckOutput}`);
    }
    if (!validation.buildPassed && validation.buildOutput) {
        errors.push(`BUILD ERRORS:\n${validation.buildOutput}`);
    }
    if (!validation.lintPassed && validation.lintOutput) {
        errors.push(`LINT ERRORS:\n${validation.lintOutput}`);
    }
    return errors.join('\n\n---\n\n');
}
