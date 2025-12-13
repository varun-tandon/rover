import type { Vote } from '../types/index.js';

export function countApprovals(votes: Vote[]): number {
  return votes.filter(v => v.approve).length;
}
