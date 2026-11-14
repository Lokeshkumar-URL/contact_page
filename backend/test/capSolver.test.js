import assert from 'node:assert/strict';
import { test } from 'node:test';
import { solveCapSolver, solveImageCapSolver } from '../src/services/captcha/capSolverClient.js';
import { capSolverTask, solveWidgetCapSolver, isCapSolverResponseReady } from '../src/services/captcha/capSolverWidget.js';

const settings = { apiKey: 'private-key', solvingEnabled: true, pollIntervalMs: 1 };
function mockService(results) {
  const calls = [];
  return { calls, fetchImpl: async (url, options) => { calls.push({ url, ...JSON.parse(options.body) }); return { ok: true, json: async () => results.shift() }; } };
}
test('CapSolver uses exact task casing and polls idle and processing responses', async () => {
  const mock = mockService([{ errorId: 0, taskId: 'task' }, { errorId: 0, status: 'idle' }, { errorId: 0, status: 'processing' }, { errorId: 0, status: 'ready', solution: { gRecaptchaResponse: 'token' } }]);
  const task = capSolverTask({ key: 'key', provider: 'recaptcha' }, 'https://owned.example/contact');
  assert.equal(task.type, 'ReCaptchaV2TaskProxyLess');
  const result = await solveCapSolver(task, { ...settings, ...mock });
  assert.equal(result.gRecaptchaResponse, 'token');
  assert.equal(mock.calls[0].url, 'https://api.capsolver.com/createTask');
  assert.equal(mock.calls[0].clientKey, settings.apiKey);
  assert.equal(mock.calls[1].taskId, 'task');
});
test('image recognition accepts the synchronous createTask result without polling', async () => {
  const mock = mockService([{ errorId: 0, status: 'ready', solution: { text: ' aBc9 ' } }]);
  assert.deepEqual(await solveImageCapSolver('data:image/png;base64,abcd', { ...settings, ...mock }), { text: 'aBc9' });
  assert.equal(mock.calls.length, 1);
  assert.equal(mock.calls[0].task.body, 'abcd');
});
test('disabled solving and missing keys make no network request', async () => {
  let calls = 0; const fetchImpl = async () => { calls++; };
  await assert.rejects(solveCapSolver({}, { ...settings, fetchImpl, solvingEnabled: false }), /disabled/);
  await assert.rejects(solveCapSolver({}, { ...settings, fetchImpl, apiKey: '' }), /CAPSOLVER_API_KEY/);
  assert.equal(calls, 0);
});
test('provider errors expose an actionable code without server descriptions or credentials', async () => {
  const mock = mockService([{ errorId: 1, errorCode: 'ERROR_ZERO_BALANCE', errorDescription: 'private-key' }]);
  await assert.rejects(solveCapSolver({}, { ...settings, ...mock }), (error) => error.code === 'ERROR_ZERO_BALANCE' && !error.message.includes('private-key'));
});
test('malformed responses and network failures are sanitized', async () => {
  await assert.rejects(solveCapSolver({}, { ...settings, fetchImpl: async () => { throw new Error('private-key'); } }), (error) => !error.message.includes('private-key'));
  await assert.rejects(solveCapSolver({}, { ...settings, ...mockService([{ errorId: 0 }]) }), /no task ID/);
});
test('pending tasks time out and already cancelled work does not create tasks', async () => {
  const fetchImpl = async (url) => ({ ok: true, json: async () => url.endsWith('createTask') ? { errorId: 0, taskId: 'one' } : { errorId: 0, status: 'processing' } });
  await assert.rejects(solveCapSolver({}, { ...settings, fetchImpl, timeoutMs: 10 }), (error) => error.code === 'CAPSOLVER_TIMEOUT');
  const controller = new AbortController(); controller.abort(new Error('stopped'));
  let calls = 0;
  await assert.rejects(solveCapSolver({}, { ...settings, signal: controller.signal, fetchImpl: async () => { calls++; } }), /stopped/);
  assert.equal(calls, 0);
});
test('enterprise and Turnstile map their optional parameters correctly', () => {
  assert.deepEqual(capSolverTask({ key: 'key', provider: 'recaptcha', enterprise: true, dataS: 's', invisible: true, action: 'submit' }, 'https://owned.example'), {
    type: 'ReCaptchaV2EnterpriseTaskProxyLess', websiteURL: 'https://owned.example', websiteKey: 'key', isInvisible: true, pageAction: 'submit', enterprisePayload: { s: 's' },
  });
  const turnstile = capSolverTask({ key: 'key', provider: 'turnstile', action: 'submit', cdata: 'data' }, 'https://owned.example');
  assert.equal(turnstile.type, 'AntiTurnstileTaskProxyLess');
  assert.deepEqual(turnstile.metadata, { action: 'submit', cdata: 'data' });
  assert.throws(() => capSolverTask({ provider: 'hcaptcha' }, 'https://owned.example'), /does not support/);
});
function widgetPage(provider = 'recaptcha') {
  const widget = { id: 'widget', key: 'key', provider };
  const page = { current: 'https://owned.example/contact', present: true, url() { return this.current; },
    evaluate: async (fn) => fn.name === 'inspectCapSolverWidgets' ? [widget] : page.present,
  };
  return page;
}
const detection = { captchas: [{ type: 'recaptcha_v2', requiresVerification: true }] };
test('external response readiness does not depend on a visual checkbox tick', async () => {
  const page = widgetPage();
  const result = await solveWidgetCapSolver({ page, formSelector: '#contact', settings, solve: async () => ({ gRecaptchaResponse: 'x'.repeat(40) }) });
  assert.equal(result.method, 'capsolver');
  assert.equal(JSON.stringify(result).includes('x'.repeat(40)), false);
  assert.equal(await isCapSolverResponseReady({ page, formSelector: '#contact', receipt: result.receipt, detection }), true);
  page.present = false;
  assert.equal(await isCapSolverResponseReady({ page, formSelector: '#contact', receipt: result.receipt, detection }), false);
});
test('response receipts cannot be forged or reused on another page', async () => {
  const page = widgetPage();
  const result = await solveWidgetCapSolver({ page, settings, solve: async () => ({ gRecaptchaResponse: 'x'.repeat(40) }) });
  assert.equal(await isCapSolverResponseReady({ page, receipt: {}, detection }), false);
  page.current = 'https://owned.example/other';
  assert.equal(await isCapSolverResponseReady({ page, receipt: result.receipt, detection }), false);
});
test('unsupported hCaptcha creates no billable task', async () => {
  let calls = 0;
  await assert.rejects(solveWidgetCapSolver({ page: widgetPage('hcaptcha'), settings, solve: async () => { calls++; } }), /does not support/);
  assert.equal(calls, 0);
});
test('additional required challenge cannot be covered by a reCAPTCHA receipt', async () => {
  const page = widgetPage();
  const result = await solveWidgetCapSolver({ page, settings, solve: async () => ({ gRecaptchaResponse: 'x'.repeat(40) }) });
  assert.equal(await isCapSolverResponseReady({ page, receipt: result.receipt, detection: { captchas: [{ type: 'hcaptcha', requiresVerification: true }] } }), false);
});
