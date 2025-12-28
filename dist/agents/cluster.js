/**
 * Issue clustering logic for consolidation.
 * Groups related issues by file path, category, and title similarity
 * without using any LLM calls.
 */
/**
 * Extract words from a title for similarity comparison.
 * Removes common stop words and normalizes to lowercase.
 */
function extractKeywords(title) {
    const stopWords = new Set([
        'a', 'an', 'the', 'in', 'on', 'at', 'to', 'for', 'of', 'with',
        'is', 'are', 'was', 'were', 'be', 'been', 'being',
        'and', 'or', 'but', 'not', 'no', 'yes',
        'this', 'that', 'these', 'those',
        'it', 'its', 'itself'
    ]);
    const words = title
        .toLowerCase()
        .replace(/[^a-z0-9\s]/g, ' ')
        .split(/\s+/)
        .filter(word => word.length > 2 && !stopWords.has(word));
    return new Set(words);
}
/**
 * Calculate Jaccard similarity between two sets of keywords.
 * Returns a value between 0 (no overlap) and 1 (identical).
 */
function jaccardSimilarity(a, b) {
    if (a.size === 0 && b.size === 0)
        return 0;
    const intersection = new Set([...a].filter(x => b.has(x)));
    const union = new Set([...a, ...b]);
    return intersection.size / union.size;
}
/**
 * Group issues into an object keyed by grouping criterion.
 */
function groupBy(items, keyFn) {
    const groups = new Map();
    for (const item of items) {
        const key = keyFn(item);
        const existing = groups.get(key);
        if (existing) {
            existing.push(item);
        }
        else {
            groups.set(key, [item]);
        }
    }
    return groups;
}
/**
 * Cluster issues by multiple criteria:
 * 1. Same file path AND same category (strongest signal)
 * 2. Same file path (different categories)
 * 3. Title similarity above threshold (for remaining unclustered issues)
 *
 * Only returns clusters with 2+ issues.
 */
export function clusterIssues(issues) {
    const clusters = [];
    const clusteredIds = new Set();
    let clusterCounter = 0;
    // Phase 1: Group by file path + category (strongest clustering signal)
    const byFileAndCategory = groupBy(issues, (i) => `${i.filePath}::${i.category}`);
    for (const [key, fileIssues] of byFileAndCategory) {
        if (fileIssues.length >= 2) {
            const [filePath, category] = key.split('::');
            clusters.push({
                id: `cluster-${clusterCounter++}`,
                reason: `Same file (${filePath}) and category (${category})`,
                issues: fileIssues
            });
            for (const issue of fileIssues) {
                clusteredIds.add(issue.id);
            }
        }
    }
    // Phase 2: Group remaining issues by file path only
    const remainingAfterPhase1 = issues.filter(i => !clusteredIds.has(i.id));
    const byFile = groupBy(remainingAfterPhase1, (i) => i.filePath);
    for (const [filePath, fileIssues] of byFile) {
        if (fileIssues.length >= 2) {
            clusters.push({
                id: `cluster-${clusterCounter++}`,
                reason: `Same file (${filePath})`,
                issues: fileIssues
            });
            for (const issue of fileIssues) {
                clusteredIds.add(issue.id);
            }
        }
    }
    // Phase 3: Title similarity for remaining unclustered issues
    const remainingAfterPhase2 = issues.filter(i => !clusteredIds.has(i.id));
    if (remainingAfterPhase2.length >= 2) {
        // Pre-compute keywords for each issue
        const issueKeywords = remainingAfterPhase2.map(issue => ({
            issue,
            keywords: extractKeywords(issue.title)
        }));
        // Find pairs with high similarity
        const similarityThreshold = 0.4; // 40% word overlap
        const similarityGroups = [];
        for (let i = 0; i < issueKeywords.length; i++) {
            const currentItem = issueKeywords[i];
            if (!currentItem || clusteredIds.has(currentItem.issue.id))
                continue;
            const group = [currentItem.issue];
            for (let j = i + 1; j < issueKeywords.length; j++) {
                const compareItem = issueKeywords[j];
                if (!compareItem || clusteredIds.has(compareItem.issue.id))
                    continue;
                const similarity = jaccardSimilarity(currentItem.keywords, compareItem.keywords);
                if (similarity >= similarityThreshold) {
                    group.push(compareItem.issue);
                    clusteredIds.add(compareItem.issue.id);
                }
            }
            if (group.length >= 2) {
                clusteredIds.add(currentItem.issue.id);
                similarityGroups.push(group);
            }
        }
        for (const group of similarityGroups) {
            clusters.push({
                id: `cluster-${clusterCounter++}`,
                reason: `Similar titles`,
                issues: group
            });
        }
    }
    return clusters;
}
/**
 * Get statistics about clustering results.
 */
export function getClusterStats(clusters) {
    const totalClusters = clusters.length;
    const totalIssuesInClusters = clusters.reduce((sum, c) => sum + c.issues.length, 0);
    const avgClusterSize = totalClusters > 0 ? totalIssuesInClusters / totalClusters : 0;
    const largestCluster = clusters.reduce((max, c) => Math.max(max, c.issues.length), 0);
    return {
        totalClusters,
        totalIssuesInClusters,
        avgClusterSize,
        largestCluster
    };
}
