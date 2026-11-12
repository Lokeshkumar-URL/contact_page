import assert from 'node:assert/strict';
import { test } from 'node:test';
import { processWebsite } from '../src/services/automation/websiteProcessor.js';

function fixture({ failureAt } = {}) {
  const calls = []; const page = { current: 'about:blank', url() { return this.current; } };
  const manager = { createPage: async () => { calls.push('createPage'); return page; }, safeClosePage: async () => calls.push('closePage') };
  const step = (name, value) => async (...args) => { calls.push(name); if (failureAt === name) throw Object.assign(new Error(`${name} failed`), { code: 'FIXTURE_FAILURE' }); return typeof value === 'function' ? value(...args) : value; };
  const form = { selector: '#contact', fields: [{ index: 0, selector: '#email', required: true, fillable: true }], submitButtons: [{ selector: '#send', text: 'Send' }] };
  const services = {
    navigateSafely: step('navigate', (_args) => { page.current = _args.url; return { finalUrl: _args.url }; }), closeCommonPopups: step('popups', {}),
    createSafeContactLinkFallback: () => null, findContactPage: step('discover', { url: 'https://example.com/contact', method: 'rules' }), extractForms: step('extract', [form]), selectContactForm: (forms) => { calls.push('select'); return { selected: forms[0] }; },
    mapFieldsWithClaudeFallback: step('map', { mappings: [{ selector: '#email', value: 'a@example.com', field: form.fields[0] }], unresolved: [], claudeUsed: false }), fillForm: step('fill', { filled: [{}] }),
    captureScreenshot: step('screenshot', 'proof.png'), verifySubmission: step('verify', { outcome: 'success', evidence: 'Thank you' }), submitForm: step('submit', async (args) => { if (args.dryRun) return { verificationEvidence: 'Form filled and validated; submission skipped.' }; const result = await args.waitForResult(page, {}); return { verificationEvidence: result.evidence }; }),
  };
  return { calls, manager, services };
}

test('dry-run pipeline connects every stage, returns a terminal result, and closes the page', async () => {
  const setup = fixture(); const result = await processWebsite({ url: 'https://example.com', rowNumber: 2 }, { runId: 'run-1', config: { dryRun: true }, profile: { email: 'a@example.com' }, browserManager: setup.manager, services: setup.services });
  assert.equal(result.status, 'Success'); assert.equal(result.dryRun, true); assert.equal(result.contactPageUrl, 'https://example.com/contact'); assert.equal(result.screenshot, 'proof.png');
  assert.deepEqual(setup.calls, ['createPage','navigate','popups','discover','navigate','popups','extract','select','map','fill','screenshot','submit','closePage']);
});

test('confirmed live pipeline delegates result verification and reports evidence', async () => {
  const setup = fixture(); const result = await processWebsite({ url: 'https://example.com', rowNumber: 3 }, { runId: 'run-2', config: { dryRun: false }, liveConfirmed: true, browserManager: setup.manager, services: setup.services });
  assert.equal(result.status, 'Success'); assert.equal(result.dryRun, false); assert.equal(result.verificationEvidence, 'Thank you'); assert.ok(setup.calls.includes('verify')); assert.equal(setup.calls.filter((call) => call === 'screenshot').length, 2);
});

test('pipeline preserves stage, captures failure evidence, and always closes the page', async () => {
  const setup = fixture({ failureAt: 'fill' });
  await assert.rejects(() => processWebsite({ url: 'https://example.com', rowNumber: 4 }, { runId: 'run-3', config: { dryRun: true }, browserManager: setup.manager, services: setup.services }), (error) => error.code === 'FIXTURE_FAILURE' && error.stage === 'form_filling' && error.screenshot === 'proof.png');
  assert.equal(setup.calls.at(-1), 'closePage');
});

test('manual-review outcomes receive their own screenshot classification', async () => {
  const setup = fixture(); let capturedStage;
  setup.services.fillForm = async () => { throw Object.assign(new Error('CAPTCHA requires review'), { code: 'MANUAL_REVIEW' }); };
  setup.services.captureScreenshot = async ({ stage }) => { capturedStage = stage; return 'manual-review.png'; };
  await assert.rejects(() => processWebsite({ url: 'https://example.com', rowNumber: 6 }, { runId: 'run-4', config: { dryRun: true }, browserManager: setup.manager, services: setup.services }), (error) => error.code === 'MANUAL_REVIEW' && error.screenshot === 'manual-review.png');
  assert.equal(capturedStage, 'manual-review'); assert.equal(setup.calls.at(-1), 'closePage');
});

test('aborted work stops before opening a browser page', async () => {
  const setup = fixture();
  await assert.rejects(() => processWebsite({ url: 'https://example.com', rowNumber: 5 }, { signal: { aborted: true }, browserManager: setup.manager, services: setup.services }), (error) => error.code === 'RUN_STOPPED');
  assert.deepEqual(setup.calls, []);
});
