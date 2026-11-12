export const EMPTY_PROGRESS = Object.freeze({
  total: 0, pending: 0, processing: 0, success: 0, failed: 0, manualReview: 0, skipped: 0,
});

const progressKeys = Object.keys(EMPTY_PROGRESS);

export function normalizeProgress(value = {}) {
  return Object.fromEntries(progressKeys.map((key) => [key, Math.max(0, Number(value[key]) || 0)]));
}

export function applyProgressEvent(current, event) {
  if (!event || typeof event !== 'object') return current;
  const next = event.progress ?? event;
  return normalizeProgress({ ...current, ...next });
}

export function calculateProgressPercent(progress) {
  if (!progress.total) return 0;
  const complete = progress.success + progress.failed + progress.manualReview + progress.skipped;
  return Math.min(100, Math.round((complete / progress.total) * 100));
}
