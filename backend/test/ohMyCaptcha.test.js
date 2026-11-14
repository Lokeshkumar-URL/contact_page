import assert from 'node:assert/strict';
import { test } from 'node:test';
import { solveOhMyCaptcha, solveImageCaptchaOhMyCaptcha } from '../src/services/captcha/ohMyCaptchaClient.js';
import { solveWidgetOhMyCaptcha } from '../src/services/captcha/ohMyCaptchaWidget.js';

function service(results) {
  const calls = [];
  return { calls, fetchImpl: async (url, options) => { calls.push({ url, ...JSON.parse(options.body) }); return { ok: true, json: async () => results.shift() }; } };
}
const settings = { baseUrl: 'http://127.0.0.1:8000', clientKey: 'secret', solvingEnabled: true, pollIntervalMs: 1 };
test('creates and polls a task using the local service protocol', async () => {
  const mock = service([{ errorId: 0, taskId: 'one' }, { errorId: 0, status: 'processing' }, { errorId: 0, status: 'ready', solution: { text: '{"captcha_type":"text","text":"Ab12"}' } }]);
  assert.deepEqual(await solveImageCaptchaOhMyCaptcha('image', { ...settings, ...mock }), { text: 'Ab12' });
  assert.equal(mock.calls[0].task.type, 'ImageToTextTask');
  assert.equal(mock.calls[0].task.body, 'image');
  assert.equal(mock.calls[1].taskId, 'one');
});
test('disabled solving makes no network requests', async () => {
  let called = false;
  await assert.rejects(solveOhMyCaptcha({}, { ...settings, solvingEnabled: false, fetchImpl: async () => { called = true; } }), /disabled/);
  assert.equal(called, false);
});
test('service errors omit credentials and server descriptions', async () => {
  const mock = service([{ errorId: 1, errorCode: 'INVALID_KEY', errorDescription: 'secret' }]);
  await assert.rejects(solveOhMyCaptcha({}, { ...settings, ...mock }), (error) => !error.message.includes('secret') && /INVALID_KEY/.test(error.message));
});
test('coordinate annotations cannot become input text', async () => {
  const mock = service([{ errorId: 0, taskId: 'one' }, { errorId: 0, status: 'ready', solution: { text: '{"captcha_type":"click","clicks":[]}' } }]);
  await assert.rejects(solveImageCaptchaOhMyCaptcha('image', { ...settings, ...mock }), /no usable/);
});
test('processing tasks time out and can be cancelled', async () => {
  const fetchImpl = async (url) => ({ ok: true, json: async () => url.endsWith('createTask') ? { errorId: 0, taskId: 'one' } : { errorId: 0, status: 'processing' } });
  await assert.rejects(solveOhMyCaptcha({}, { ...settings, fetchImpl, timeoutMs: 15 }), /timed out/);
  const controller = new AbortController(); controller.abort(new Error('stopped'));
  await assert.rejects(solveOhMyCaptcha({}, { ...settings, fetchImpl, signal: controller.signal }), /stopped/);
});
test('explicit widget maps to task and receives its token', async () => {
  let applied; let requested;
  const page = { url: () => 'https://owned.example/contact', evaluate: async (fn, arg) => {
    if (arg?.token) { applied = arg; return true; }
    return [{ key: 'site-key', provider: 'turnstile', invisible: false }];
  } };
  const result = await solveWidgetOhMyCaptcha({ page, settings, solve: async (task) => { requested = task; return { token: 'result-token' }; } });
  assert.equal(requested.type, 'TurnstileTaskProxyless');
  assert.equal(requested.websiteURL, page.url());
  assert.equal(applied.token, 'result-token');
  assert.equal(result.method, 'ohmycaptcha');
});
test('unsupported widgets fail for manual fallback', async () => {
  await assert.rejects(solveWidgetOhMyCaptcha({ page: { evaluate: async () => [] }, settings }), /No supported/);
});


// An injected response must not bypass the current browser's checkbox or another outstanding challenge.
import { isVerificationComplete, waitForHumanVerification } from '../src/services/captcha/detection/verificationMonitor.js';
const checkboxDetection = { requiresVerification: true, captchas: [{ type: 'recaptcha_v2', requiresVerification: true }] };
function verificationPage({ token = true, checked = false, hcaptcha = true } = {}) {
  return {
    evaluate: async () => ({ recaptcha: token, hcaptcha, turnstile: false, challengePresent: false }),
    frames: () => [{ url: () => 'https://www.google.com/recaptcha/api2/anchor?k=test', evaluate: async () => checked }],
  };
}
test('a response token without a checked browser widget is not verification', async () => {
  assert.equal(await isVerificationComplete(verificationPage({ checked: false }), checkboxDetection), false);
  const outcome = await waitForHumanVerification({ page: verificationPage({ checked: false }), detection: checkboxDetection, timeoutMs: 0 });
  assert.equal(outcome.status, 'human_required');
});
test('checked widget still needs its response and every other required challenge', async () => {
  assert.equal(await isVerificationComplete(verificationPage({ checked: true }), checkboxDetection), true);
  assert.equal(await isVerificationComplete(verificationPage({ checked: true, token: false }), checkboxDetection), false);
  const mixed = { requiresVerification: true, captchas: [...checkboxDetection.captchas, { type: 'hcaptcha', requiresVerification: true }] };
  const result = await waitForHumanVerification({ page: verificationPage({ checked: true, hcaptcha: false }), detection: mixed, timeoutMs: 5, pollMs: 1 });
  assert.equal(result.status, 'timeout');
});
test('widget solver rejects a separate-browser token while the actual checkbox is unchecked', async () => {
  const page = {
    url: () => 'https://owned.example/contact',
    evaluate: async (fn, arg) => arg?.token ? true : [{ key: 'key', provider: 'recaptcha', invisible: false }],
    frames: () => [{ url: () => 'https://www.google.com/recaptcha/api2/anchor?k=key', evaluate: async () => false }],
  };
  // Frame owns the widget host for this isolated test.
  page.frames = () => [page, { url: () => 'https://www.google.com/recaptcha/api2/anchor?k=key', evaluate: async () => false }];
  await assert.rejects(solveWidgetOhMyCaptcha({ page, settings, solve: async () => ({ gRecaptchaResponse: 'external-token' }) }), /still unverified/);
});
