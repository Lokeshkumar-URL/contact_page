export const progressEventSchema = {
  eventId: 'number', runId: 'string', status: 'string', progress: { processed: 'number', total: 'number', remaining: 'number', success: 'number', failed: 'number', manualReview: 'number', skipped: 'number', currentBatch: 'number' }, updatedAt: 'string',
};
