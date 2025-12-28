export function countApprovals(votes) {
    return votes.filter(v => v.approve).length;
}
