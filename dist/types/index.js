/**
 * Core types for the Rover codebase scanner
 */
/**
 * JSON schema for structured output from scanner agent
 */
export const candidateIssuesSchema = {
    type: 'object',
    properties: {
        issues: {
            type: 'array',
            items: {
                type: 'object',
                properties: {
                    id: { type: 'string' },
                    title: { type: 'string' },
                    description: { type: 'string' },
                    severity: { type: 'string', enum: ['low', 'medium', 'high', 'critical'] },
                    filePath: { type: 'string' },
                    lineRange: {
                        type: 'object',
                        properties: {
                            start: { type: 'number' },
                            end: { type: 'number' }
                        },
                        required: ['start', 'end']
                    },
                    category: { type: 'string' },
                    recommendation: { type: 'string' },
                    codeSnippet: { type: 'string' }
                },
                required: ['id', 'title', 'description', 'severity', 'filePath', 'category', 'recommendation']
            }
        }
    },
    required: ['issues']
};
