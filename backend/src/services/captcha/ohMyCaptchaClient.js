import { setTimeout as delay } from 'node:timers/promises';

export class OhMyCaptchaError extends Error {
  constructor(message) { super(message); this.name = 'OhMyCaptchaError'; this.code = 'OHMYCAPTCHA_FAILED'; }
}

export async function solveOhMyCaptcha(task, { baseUrl, clientKey = '', timeoutMs = 120000, pollIntervalMs = 1000, solvingEnabled = false, signal, fetchImpl = globalThis.fetch } = {}) {
  if (!solvingEnabled) throw new OhMyCaptchaError('Automatic CAPTCHA solving is disabled.');
  const url = new URL(baseUrl);
  if (!['http:', 'https:'].includes(url.protocol)) throw new OhMyCaptchaError('Use an HTTP(S) solver URL.');
  const deadline = AbortSignal.timeout(timeoutMs);
  const combined = signal ? AbortSignal.any([signal, deadline]) : deadline;
  const post = async (endpoint, payload) => {
    const response = await fetchImpl(`${url.href.replace(/\/$/, '')}/${endpoint}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ clientKey, ...payload }), signal: combined });
    if (!response.ok) throw new OhMyCaptchaError(`Solver HTTP ${response.status}.`);
    const result = await response.json();
    if (result.errorId !== 0) throw new OhMyCaptchaError(`Solver rejected task (${result.errorCode || 'unknown error'}).`);
    return result;
  };
  try {
    const { taskId } = await post('createTask', { task });
    if (!taskId) throw new OhMyCaptchaError('Solver returned no task ID.');
    while (true) {
      const result = await post('getTaskResult', { taskId });
      if (result.status === 'ready' && result.solution) return result.solution;
      if (result.status !== 'processing') throw new OhMyCaptchaError('Solver returned an invalid task result.');
      await delay(pollIntervalMs, undefined, { signal: combined });
    }
  } catch (error) {
    if (signal?.aborted) throw signal.reason ?? error;
    if (deadline.aborted) throw new OhMyCaptchaError('Solver timed out.');
    if (error instanceof OhMyCaptchaError) throw error;
    throw new OhMyCaptchaError('Solver request failed. Check the service and model configuration.');
  }
}

export async function solveImageCaptchaOhMyCaptcha(image, options) {
  const solution = await solveOhMyCaptcha({ type: 'ImageToTextTask', body: image }, options);
  let text = solution.text;
  if (typeof text === 'string' && text.trim().startsWith('{')) {
    try { const data = JSON.parse(text); text = data.captcha_type === 'text' ? data.text : null; } catch { text = null; }
  }
  if (typeof text !== 'string' || !text.trim() || text.length > 200) throw new OhMyCaptchaError('Solver returned no usable CAPTCHA text.');
  return { text: text.trim() };
}
