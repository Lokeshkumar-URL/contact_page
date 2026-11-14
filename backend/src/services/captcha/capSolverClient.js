import { setTimeout as delay } from 'node:timers/promises';

export class CapSolverError extends Error {
  constructor(message, code = 'CAPSOLVER_FAILED') { super(message); this.name = 'CapSolverError'; this.code = code; this.retryable = false; }
}

export async function solveCapSolver(task, { apiKey, solvingEnabled = false, timeoutMs = 180000, pollIntervalMs = 3000, signal, fetchImpl = globalThis.fetch } = {}) {
  if (!solvingEnabled) throw new CapSolverError('Automatic CAPTCHA solving is disabled.', 'CAPSOLVER_DISABLED');
  if (!apiKey?.trim()) throw new CapSolverError('Set CAPSOLVER_API_KEY in backend/.env.', 'CAPSOLVER_KEY_MISSING');
  const deadline = AbortSignal.timeout(timeoutMs);
  const combined = signal ? AbortSignal.any([signal, deadline]) : deadline;
  const post = async (endpoint, payload) => {
    combined.throwIfAborted();
    const response = await fetchImpl(`https://api.capsolver.com/${endpoint}`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ clientKey: apiKey.trim(), ...payload }), signal: combined,
    });
    if (!response.ok) throw new CapSolverError(`CapSolver HTTP ${response.status}.`);
    const data = await response.json();
    if (data.errorId !== 0) {
      // Server descriptions can contain request data. Keep only a constrained error code.
      const code = /^ERROR_[A-Z0-9_]+$/.test(data.errorCode ?? '') ? data.errorCode : 'CAPSOLVER_FAILED';
      throw new CapSolverError(`CapSolver rejected the task (${code}). Check your key, balance, and task parameters.`, code);
    }
    return data;
  };
  try {
    const created = await post('createTask', { task });
    if (created.status === 'ready' && created.solution) return created.solution;
    if (!created.taskId) throw new CapSolverError('CapSolver returned no task ID.');
    for (let poll = 0; poll < 120; poll++) {
      await delay(pollIntervalMs, undefined, { signal: combined });
      const result = await post('getTaskResult', { taskId: created.taskId });
      if (result.status === 'ready' && result.solution) return result.solution;
      if (!['idle', 'processing'].includes(result.status)) throw new CapSolverError('CapSolver returned an invalid task status.');
    }
    throw new CapSolverError('CapSolver polling limit reached.', 'CAPSOLVER_TIMEOUT');
  } catch (error) {
    if (signal?.aborted) throw signal.reason ?? error;
    if (deadline.aborted) throw new CapSolverError('CapSolver timed out.', 'CAPSOLVER_TIMEOUT');
    if (error instanceof CapSolverError) throw error;
    throw new CapSolverError('CapSolver could not be reached or returned an invalid response.');
  }
}

export async function solveImageCapSolver(image, settings) {
  const solution = await solveCapSolver({ type: 'ImageToTextTask', body: String(image).replace(/^data:image\/[^;]+;base64,/, '') }, settings);
  if (typeof solution.text !== 'string' || !solution.text.trim() || solution.text.length > 200) throw new CapSolverError('CapSolver returned no usable image text.');
  return { text: solution.text.trim() };
}
