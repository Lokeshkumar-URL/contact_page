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

test('submit controls are recognized across common website labels', () => {
  for (const text of ['Send', 'Submit', 'Submit Message', 'Send a Message', 'Contact Us', 'Request Quote', 'Send Enquiry', 'Get in Touch', 'Talk to Sales', 'Book a Demo', 'Request Information']) {
    assert.equal(selectSubmitButton({ submitButtons: [{ selector: '#primary', text }, { selector: '#other', text: 'Next' }] }).selector, '#primary');
  }
  assert.equal(selectSubmitButton({ submitButtons: [{ selector: '#only', text: 'Go' }] }).selector, '#only');
});

test('Claude submit fallback is called only when deterministic rules are ambiguous', async () => {
  let fallbackCalls = 0;
  const clearResult = await submitForm({ page: page(), form, dryRun: true, resolveSubmitButton: async () => { fallbackCalls += 1; return null; } });
  assert.equal(clearResult.claudeAttempted, false); assert.equal(fallbackCalls, 0);

  const ambiguousForm = { selector: '#contact', submitButtons: [{ selector: '#a', text: 'Action A' }, { selector: '#b', text: 'Action B' }] };
  const fallbackResult = await submitForm({ page: page(), form: ambiguousForm, dryRun: true, resolveSubmitButton: async (buttons) => { fallbackCalls += 1; return { button: buttons[1], claudeAttempted: true, claudeUsed: true }; } });
  assert.equal(fallbackResult.claudeAttempted, true); assert.equal(fallbackResult.claudeUsed, true); assert.equal(fallbackCalls, 1);
});

test('an unavailable or uncertain Claude fallback never invents a submit action', async () => {
  const ambiguousForm = { selector: '#contact', submitButtons: [{ selector: '#a', text: 'Action A' }, { selector: '#b', text: 'Action B' }] };
  await assert.rejects(() => submitForm({ page: page(), form: ambiguousForm, dryRun: true, resolveSubmitButton: async () => ({ button: null, claudeAttempted: true, claudeUsed: false }) }), (error) => error instanceof SubmissionError && error.submissionStarted === false);
});
