import type { CheckerStatus } from '../types/index.js';
interface CheckingProgressProps {
    issueCount: number;
    checker: CheckerStatus;
    isComplete: boolean;
}
export declare function CheckingProgress({ issueCount, checker, isComplete }: CheckingProgressProps): import("react/jsx-runtime").JSX.Element;
export {};
