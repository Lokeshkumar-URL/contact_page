export const SUCCESS = /thank\s*you|thanks for (?:reaching out|getting in touch|contacting|your (?:message|inquiry|enquiry|interest|submission|request))|message (?:has been |was )?(?:sent|received|delivered)|successfully (?:submitted|sent|received)|submission (?:was |has been )?(?:successful|received)|form (?:has been |was )?(?:submitted|received)|we(?:'|’)?ll be in touch|we will be in touch|we(?:'|’)?ll (?:get back|contact you|respond|reach out)|we will (?:get back|contact you|respond|reach out)|(?:someone|a member of our team|our team|a representative) will (?:be in touch|contact you|get back|reach out)|received your (?:message|request|enquiry|inquiry|submission)|your (?:message|request|inquiry|enquiry|submission) (?:has been|was) (?:sent|received|submitted)/i;
const CONFIRMATION_URL = /(?:thank[-_]?you|thanks|success|confirmation|confirmed|submitted|complete)(?:[/.?#_-]|$)/i;
const CONFIRMATION_PAGE = /submission complete|request confirmed|confirmation number|reference (?:number|id)|we have received/i;

export function classifySubmissionState({ bodyText = '', currentUrl = '', initialUrl = '', formPresent = true, validationMessages = [] } = {}) {
  if (validationMessages.length) return { outcome: 'validation-error', signal: 'validation-errors', evidence: validationMessages.slice(0, 5).join('; ') };
  const success = SUCCESS.exec(bodyText); if (success) return { outcome: 'success', signal: 'thank-you-message', evidence: success[0] };
  const confirmation = CONFIRMATION_PAGE.exec(bodyText); if (confirmation) return { outcome: 'success', signal: 'confirmation-page', evidence: confirmation[0] };
  if (currentUrl && currentUrl !== initialUrl && CONFIRMATION_URL.test(currentUrl)) return { outcome: 'success', signal: 'confirmation-url', evidence: currentUrl };
  if (!formPresent) return { outcome: 'success', signal: 'form-disappeared', evidence: 'Contact form disappeared after submission.' };
  if (currentUrl && initialUrl && currentUrl !== initialUrl) return { outcome: 'url-changed', signal: 'url-change', evidence: `${initialUrl} -> ${currentUrl}` };
  return null;
}

// Number of success phrases already on the page before the click, so pre-existing text such as a
// footer "Thank you for visiting" can never be mistaken for a confirmation.
export async function countSuccessPhrases(page) {
  if (typeof page?.evaluate !== 'function') return 0;
  return page.evaluate((source) => ((document.body?.innerText ?? '').match(new RegExp(source, 'gi')) ?? []).length, SUCCESS.source).catch(() => 0);
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const NAVIGATION_ERROR = /execution context was destroyed|cannot find context|detached|navigat|target closed|context.*not.*found/i;

/**
 * Waits up to `timeout` for a strong confirmation: a NEW thank-you message, a confirmation page or URL,
 * visible validation errors, or the form disappearing. A plain URL change is only a weak signal, so the
 * verifier keeps watching (the thank-you text often appears after a redirect) and reports it only if
 * nothing stronger shows up before the deadline. Redirects mid-check are followed, not treated as failures.
 */
export async function verifySubmission(page, { formSelector, initialUrl = '', timeout = 90000, baselineSuccessCount = 0 } = {}) {
  if (!page) throw new TypeError('A Puppeteer page is required.');
  const args = { selector: formSelector, initial: initialUrl, baseline: baselineSuccessCount, successSource: SUCCESS.source, confirmationUrlSource: CONFIRMATION_URL.source, confirmationPageSource: CONFIRMATION_PAGE.source };
  const deadline = Date.now() + timeout; let lastError;
  while (Date.now() < deadline) {
    try {
      const handle = await page.waitForFunction(({ selector, initial, baseline, successSource, confirmationUrlSource, confirmationPageSource }) => {
        const text = document.body?.innerText ?? ''; const current = window.location.href;
        const successes = text.match(new RegExp(successSource, 'gi')) ?? [];
        const form = selector ? document.querySelector(selector) : null;
        const visible = (node) => Boolean(node.offsetWidth || node.offsetHeight || node.getClientRects().length);
        const fieldErrors = form ? [...form.querySelectorAll('[role="alert"],.error,.invalid-feedback,.field-error,.wpcf7-not-valid-tip,[aria-invalid="true"]')] : [];
        const summaries = [...document.querySelectorAll('.gform_validation_errors,.gfield_validation_message,.validation_error,.validation-summary-errors,.wpcf7 form.invalid .wpcf7-response-output')];
        const messages = [...new Set([...fieldErrors, ...summaries])].filter(visible).map((node) => (node.textContent || '').trim()).filter(Boolean);
        if (messages.length) return { outcome: 'validation-error', signal: 'validation-errors', evidence: messages.slice(0, 5).join('; ') };
        if (successes.length > baseline || (current !== initial && successes.length)) return { outcome: 'success', signal: 'thank-you-message', evidence: successes[successes.length - 1] };
        const confirmation = new RegExp(confirmationPageSource, 'i').exec(text);
        if (confirmation) return { outcome: 'success', signal: 'confirmation-page', evidence: confirmation[0] };
        if (current !== initial && new RegExp(confirmationUrlSource, 'i').test(current)) return { outcome: 'success', signal: 'confirmation-url', evidence: current };
        if (selector && !form && document.readyState === 'complete') return { outcome: 'success', signal: 'form-disappeared', evidence: 'Contact form disappeared after submission.' };
        return false;
      }, { timeout: Math.max(1000, deadline - Date.now()), polling: 250 }, args);
      return typeof handle?.jsonValue === 'function' ? await handle.jsonValue() : handle;
    } catch (error) {
      lastError = error;
      if (NAVIGATION_ERROR.test(error?.message ?? '')) { await sleep(500); continue; } // page is redirecting; check the new page
      break;
    }
  }
  // Deadline reached without a strong signal: report a URL change if one happened, otherwise give up.
  const current = typeof page.url === 'function' ? page.url() : '';
  if (initialUrl && current && current !== initialUrl) return { outcome: 'url-changed', signal: 'url-change', evidence: `${initialUrl} -> ${current}` };
  throw lastError ?? new Error(`No submission result was detected within ${Math.round(timeout / 1000)} seconds.`);
}
