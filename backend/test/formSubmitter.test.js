import assert from 'node:assert/strict';
import { beforeEach, test } from 'node:test';
import { SubmissionError, SubmissionUncertainError, resetSubmissionLocksForTests, selectSubmitButton, submitForm } from '../src/services/browser/formSubmitter.js';

const form = { selector: '#contact', submitButtons: [{ selector: '#send', text: 'Send enquiry', disabled: false }] };
const page = () => ({ clicks: [], screenshots: [], click: async function (selector) { this.clicks.push(selector); }, screenshot: async function (options) { this.screenshots.push(options); }, url: () => 'https://example.test/contact' });
beforeEach(() => resetSubmissionLocksForTests());

test('dry run captures evidence and never clicks', async () => {
  const browserPage = page(); const result = await submitForm({ page: browserPage, form, dryRun: true, screenshotPath: 'before.png' });
  assert.equal(result.status, 'Dry Run'); assert.equal(result.clicked, false); assert.deepEqual(browserPage.clicks, []); assert.equal(result.screenshot, 'before.png');
});

test('live mode requires explicit confirmation before clicking', async () => {
  const browserPage = page();
  await assert.rejects(() => submitForm({ page: browserPage, form, dryRun: false }), (error) => error instanceof SubmissionError && error.code === 'LIVE_CONFIRMATION_REQUIRED' && error.submissionStarted === false);
  assert.deepEqual(browserPage.clicks, []);
});

test('confirmed live submission clicks once and returns verified success', async () => {
  const browserPage = page(); let verificationOptions; const result = await submitForm({ page: browserPage, form, dryRun: false, liveConfirmed: true, submissionKey: 'run:row2', waitForResult: async (_page, options) => { verificationOptions = options; return { outcome: 'success', evidence: 'Thank you' }; } });
  assert.equal(result.status, 'Success'); assert.deepEqual(browserPage.clicks, ['#send']); assert.equal(result.verificationEvidence, 'Thank you');
  assert.equal(verificationOptions.initialUrl, 'https://example.test/contact');
});

test('duplicate submission keys never click twice', async () => {
  const browserPage = page(); await submitForm({ page: browserPage, form, dryRun: false, liveConfirmed: true, submissionKey: 'same', waitForResult: async () => ({ outcome: 'success', evidence: 'Sent' }) });
  await assert.rejects(() => submitForm({ page: browserPage, form, dryRun: false, liveConfirmed: true, submissionKey: 'same' }), (error) => error instanceof SubmissionUncertainError && error.code === 'MANUAL_REVIEW');
  assert.deepEqual(browserPage.clicks, ['#send']);
});

test('timeouts and ambiguous results are non-retryable uncertain submissions', async () => {
  const timeoutPage = page();
  await assert.rejects(() => submitForm({ page: timeoutPage, form, dryRun: false, liveConfirmed: true, submissionKey: 'timeout', waitForResult: async () => { throw new Error('timeout'); } }), (error) => error.code === 'MANUAL_REVIEW' && error.submissionStarted === true && error.retryable === false);
  const ambiguousPage = page();
  await assert.rejects(() => submitForm({ page: ambiguousPage, form, dryRun: false, liveConfirmed: true, submissionKey: 'ambiguous', waitForResult: async () => ({ outcome: 'validation-error', evidence: 'Required' }) }), (error) => error instanceof SubmissionUncertainError);
});

test('ambiguous submit controls are blocked before clicking', () => {
  assert.equal(selectSubmitButton({ submitButtons: [{ selector: '#a', text: 'Continue' }, { selector: '#b', text: 'Next' }] }), null);
});
