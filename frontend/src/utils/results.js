export const RESULT_STATUSES = Object.freeze({
  pending: { label: 'Pending', tone: 'neutral' },
  processing: { label: 'Processing', tone: 'info' },
  success: { label: 'Success', tone: 'success' },
  failed: { label: 'Failed', tone: 'danger' },
  manual_review: { label: 'Manual review', tone: 'warning' },
  skipped: { label: 'Skipped', tone: 'neutral' },
});

export function filterResults(results, { status = 'all', query = '' } = {}) {
  const normalizedQuery = query.trim().toLowerCase();
  return results.filter((result) => {
    const matchesStatus = status === 'all' || result.status === status;
    const searchable = [result.url, result.contactPageUrl, result.reason, result.runId].filter(Boolean).join(' ').toLowerCase();
    return matchesStatus && (!normalizedQuery || searchable.includes(normalizedQuery));
  });
}

export function summarizeResults(results) {
  const summary = { total: results.length, pending: 0, processing: 0, success: 0, failed: 0, manualReview: 0, skipped: 0 };
  for (const result of results) {
    const key = result.status === 'manual_review' ? 'manualReview' : result.status;
    if (key in summary) summary[key] += 1;
  }
  return summary;
}
