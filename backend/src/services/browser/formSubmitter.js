import { SUCCESS, countSuccessPhrases, verifySubmission } from './submissionVerifier.js';

const startedSubmissions = new Set();
const SUCCESS_PATTERN = SUCCESS;

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

const submitPhrases = [
  'send message','send a message','submit message','send enquiry','send inquiry','submit enquiry','submit inquiry',
  'submit form','send form','send request','submit request','request information','request info','request a quote',
  'request quote','get a quote','get quote','contact us','contact team','get in touch','reach out','talk to sales',
  'book a demo','book demo','schedule a demo','schedule demo','send','submit',
];
const nonSubmitPattern = /newsletter|subscribe|search|sign in|log in|login|register|upload|reset|cancel|back|previous|next|continue|save draft|share|refer/i;

function buttonText(button) {
  return `${button.text ?? ''} ${button.value ?? ''} ${button.accessibleName ?? ''} ${button.name ?? ''} ${button.id ?? ''}`.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
}

export function scoreSubmitButton(button = {}) {
  const text = buttonText(button);
  if (!text || nonSubmitPattern.test(text)) return -100;
  let score = 0;
  for (const phrase of submitPhrases) {
    if (text === phrase) score = Math.max(score, 120);
    else if (text.includes(phrase)) score = Math.max(score, phrase.includes(' ') ? 95 : 75);
  }
  if (/\b(send|submit)\b/.test(text)) score = Math.max(score, 85);
  if (/\b(contact|message|enquiry|inquiry|quote|request)\b/.test(text)) score += 10;
  return score;
}

export function selectSubmitButton(form = {}) {
  const buttons = (form.submitButtons ?? []).filter((button) => !button.disabled && button.selector);
  if (buttons.length === 1) return buttons[0];
  const ranked = buttons.map((button) => ({ button, score: scoreSubmitButton(button) })).sort((left, right) => right.score - left.score);
  if (!ranked.length || ranked[0].score < 60 || ranked[0].score === ranked[1]?.score) return null;
  return ranked[0].button;
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

export async function submitForm({ page, form = {}, dryRun = true, liveConfirmed = false, screenshotPath = '', submissionKey, timeout = 15000, capture = defaultCapture, waitForResult = verifySubmission, resolveSubmitButton } = {}) {
  if (!page) throw new TypeError('A Puppeteer page is required.');
  let button = selectSubmitButton(form); let claudeAttempted = false; let claudeUsed = false;
  if (!button && resolveSubmitButton) {
    const fallback = await resolveSubmitButton((form.submitButtons ?? []).filter((candidate) => !candidate.disabled && candidate.selector));
    const wrapped = fallback && typeof fallback === 'object' && Object.hasOwn(fallback, 'button');
    button = wrapped ? fallback.button : fallback ?? null; claudeAttempted = fallback?.claudeAttempted === true; claudeUsed = fallback?.claudeUsed === true || (!wrapped && Boolean(button));
  }
  if (!button) throw new SubmissionError('No unique, enabled submit button was found.');
  const key = submissionKey || `${form.selector || page.url?.() || 'page'}::${button.selector}`;
  const screenshot = await capture(page, screenshotPath);
  if (dryRun) return { status: 'Dry Run', clicked: false, screenshot, verificationEvidence: 'Form filled and validated; submission skipped.', claudeAttempted, claudeUsed };
  if (liveConfirmed !== true) throw new SubmissionError('Live submission requires explicit confirmation.', { code: 'LIVE_CONFIRMATION_REQUIRED' });
  if (startedSubmissions.has(key)) throw new SubmissionUncertainError('This submission was already started; a duplicate click was blocked.', [{ code: 'DUPLICATE_CLICK_BLOCKED', submissionKey: key }]);
  startedSubmissions.add(key);
  const initialUrl = page.url?.() ?? ''; const baselineSuccessCount = await countSuccessPhrases(page);
  try { await page.click(button.selector); } catch (error) { throw new SubmissionUncertainError('The submit click outcome is uncertain; do not retry automatically.', [{ code: 'CLICK_OUTCOME_UNCERTAIN', message: error.message }]); }
  let result;
  try { result = await waitForResult(page, { formSelector: form.selector, initialUrl, timeout, baselineSuccessCount }); } catch (error) { throw new SubmissionUncertainError('No reliable submission result was detected; do not retry automatically.', [{ code: 'RESULT_TIMEOUT', message: error.message, waitedSeconds: Math.round(timeout / 1000) }]); }
  if (result?.outcome !== 'success') throw new SubmissionUncertainError('The page did not provide reliable success confirmation; do not retry automatically.', [{ code: result?.outcome === 'validation-error' ? 'VALIDATION_AFTER_CLICK' : 'AMBIGUOUS_RESULT', evidence: result?.evidence ?? '' }]);
  return { status: 'Success', clicked: true, screenshot, verificationEvidence: result.evidence, claudeAttempted, claudeUsed };
}

export function resetSubmissionLocksForTests() { startedSubmissions.clear(); }
