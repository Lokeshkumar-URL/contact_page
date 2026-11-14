export const retryPolicy = Object.freeze({ maxAttempts: 3, baseDelayMs: 2000, retryableStages: ['navigation', 'page_load'] });
export function isSafeToRetry(error, attempt, policy = retryPolicy) { return attempt < policy.maxAttempts && error?.retryable === true && error?.submissionStarted !== true && policy.retryableStages.includes(error?.stage); }
export async function executeWithRetry(operation, policy = retryPolicy, wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms))) {
  let attempt = 1;
  while (true) { try { return await operation(attempt); } catch (error) { if (!isSafeToRetry(error, attempt, policy)) throw error; await wait(policy.baseDelayMs * attempt); attempt += 1; } }
}
