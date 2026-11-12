import { verifySubmission } from './submissionVerifier.js';

const startedSubmissions = new Set();
const SUCCESS_PATTERN = /thank\s*you|message (?:has been )?sent|successfully submitted|submission (?:was )?successful|we(?:'|’)ll be in touch|received your (?:message|request|enquiry|inquiry)/i;

export class SubmissionError extends Error {
  constructor(message, { code = 'SUBMISSION_BLOCKED', details = [], submissionStarted = false } = {}) {
    super(message); this.name = 'SubmissionError'; this.code = code; this.stage = 'submission'; this.retryable = false; this.submissionStarted = submissionStarted; this.details = details;
  }
}

export class SubmissionUncertainError extends SubmissionError {
  constructor(message = 'Submission result is uncertain; manual review is required.', details = []) {
    super(message, { code: 'MANUAL_REVIEW', details, submissionStarted: true }); this.name = 'SubmissionUncertainError';
  }
}

export function selectSubmitButton(form = {}) {
  const buttons = (form.submitButtons ?? []).filter((button) => !button.disabled && button.selector);
  return buttons.find((button) => /send|submit|contact|quote|enquir|request/i.test(`${button.text ?? ''} ${button.value ?? ''} ${button.accessibleName ?? ''}`)) ?? (buttons.length === 1 ? buttons[0] : null);
}

async function defaultCapture(page, screenshotPath) {
  if (!screenshotPath) return '';
  await page.screenshot({ path: screenshotPath, fullPage: true });
  return screenshotPath;
}

async function defaultWaitForResult(page, { formSelector, timeout }) {
  const handle = await page.waitForFunction(({ selector, successSource }) => {
    const bodyText = document.body?.innerText ?? ''; const success = new RegExp(successSource, 'i').exec(bodyText);
    if (success) return { outcome: 'success', evidence: success[0] };
    const form = selector ? document.querySelector(selector) : null;
    const validation = form ? [...form.querySelectorAll('[role="alert"],.error,.invalid-feedback,.field-error,[aria-invalid="true"]')].map((node) => (node.textContent || '').trim()).filter(Boolean) : [];
    if (validation.length) return { outcome: 'validation-error', evidence: validation.slice(0, 5).join('; ') };
    return false;
  }, { timeout, polling: 250 }, { selector: formSelector, successSource: SUCCESS_PATTERN.source });
  return typeof handle?.jsonValue === 'function' ? handle.jsonValue() : handle;
}

export async function submitForm({ page, form = {}, dryRun = true, liveConfirmed = false, screenshotPath = '', submissionKey, timeout = 15000, capture = defaultCapture, waitForResult = verifySubmission } = {}) {
  if (!page) throw new TypeError('A Puppeteer page is required.');
  const button = selectSubmitButton(form);
  if (!button) throw new SubmissionError('No unique, enabled submit button was found.');
  const key = submissionKey || `${form.selector || page.url?.() || 'page'}::${button.selector}`;
  const screenshot = await capture(page, screenshotPath);
  if (dryRun) return { status: 'Dry Run', clicked: false, screenshot, verificationEvidence: 'Form filled and validated; submission skipped.' };
  if (liveConfirmed !== true) throw new SubmissionError('Live submission requires explicit confirmation.', { code: 'LIVE_CONFIRMATION_REQUIRED' });
  if (startedSubmissions.has(key)) throw new SubmissionUncertainError('This submission was already started; a duplicate click was blocked.', [{ code: 'DUPLICATE_CLICK_BLOCKED', submissionKey: key }]);
  startedSubmissions.add(key);
  const initialUrl = page.url?.() ?? '';
  try { await page.click(button.selector); } catch (error) { throw new SubmissionUncertainError('The submit click outcome is uncertain; do not retry automatically.', [{ code: 'CLICK_OUTCOME_UNCERTAIN', message: error.message }]); }
  let result;
  try { result = await waitForResult(page, { formSelector: form.selector, initialUrl, timeout }); } catch (error) { throw new SubmissionUncertainError('No reliable submission result was detected; do not retry automatically.', [{ code: 'RESULT_TIMEOUT', message: error.message }]); }
  if (result?.outcome !== 'success') throw new SubmissionUncertainError('The page did not provide reliable success confirmation; do not retry automatically.', [{ code: result?.outcome === 'validation-error' ? 'VALIDATION_AFTER_CLICK' : 'AMBIGUOUS_RESULT', evidence: result?.evidence ?? '' }]);
  return { status: 'Success', clicked: true, screenshot, verificationEvidence: result.evidence };
}

export function resetSubmissionLocksForTests() { startedSubmissions.clear(); }
