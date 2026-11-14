import { apiRequest } from '../api/httpClient.js';

/** Deletes submission-activity records (all from one run) and returns how many were removed. */
export async function deleteResults(items) {
  if (!items.length) return 0;
  const runId = encodeURIComponent(items[0].runId);
  if (items.length === 1) { await apiRequest(`/results/${runId}/${items[0].rowNumber}`, { method: 'DELETE' }); return 1; }
  const result = await apiRequest(`/results/${runId}/bulk-delete`, { method: 'POST', body: JSON.stringify({ rowNumbers: items.map((item) => item.rowNumber) }) });
  return result.deleted.length;
}
