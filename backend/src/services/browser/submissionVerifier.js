const SUCCESS = /thank\s*you|message (?:has been )?sent|successfully submitted|submission (?:was )?successful|we(?:'|’)?ll be in touch|received your (?:message|request|enquiry|inquiry)/i;
const CONFIRMATION_URL = /(?:thank[-_]?you|thanks|success|confirmation|confirmed|submitted|complete)(?:[/.?#_-]|$)/i;
const CONFIRMATION_PAGE = /submission complete|request confirmed|confirmation number|reference (?:number|id)|we have received/i;

export function classifySubmissionState({ bodyText = '', currentUrl = '', initialUrl = '', formPresent = true, validationMessages = [] } = {}) {
  const success = SUCCESS.exec(bodyText); if (success) return { outcome: 'success', signal: 'thank-you-message', evidence: success[0] };
  if (validationMessages.length) return { outcome: 'validation-error', signal: 'validation-errors', evidence: validationMessages.slice(0, 5).join('; ') };
  const confirmation = CONFIRMATION_PAGE.exec(bodyText); if (confirmation) return { outcome: 'success', signal: 'confirmation-page', evidence: confirmation[0] };
  if (currentUrl && currentUrl !== initialUrl && CONFIRMATION_URL.test(currentUrl)) return { outcome: 'success', signal: 'confirmation-url', evidence: currentUrl };
  if (!formPresent) return { outcome: 'success', signal: 'form-disappeared', evidence: 'Contact form disappeared after submission.' };
  if (currentUrl && initialUrl && currentUrl !== initialUrl) return { outcome: 'url-changed', signal: 'url-change', evidence: `${initialUrl} -> ${currentUrl}` };
  return null;
}

export async function verifySubmission(page, { formSelector, initialUrl = '', timeout = 15000 } = {}) {
  if (!page) throw new TypeError('A Puppeteer page is required.');
  const handle = await page.waitForFunction(({ selector, initial, successSource, confirmationUrlSource, confirmationPageSource }) => {
    const text = document.body?.innerText ?? ''; const current = window.location.href; const success = new RegExp(successSource, 'i').exec(text);
    if (success) return { outcome: 'success', signal: 'thank-you-message', evidence: success[0] };
    const form = selector ? document.querySelector(selector) : null;
    const messages = form ? [...form.querySelectorAll('[role="alert"],.error,.invalid-feedback,.field-error,[aria-invalid="true"]')].map((node) => (node.textContent || '').trim()).filter(Boolean) : [];
    if (messages.length) return { outcome: 'validation-error', signal: 'validation-errors', evidence: messages.slice(0, 5).join('; ') };
    const confirmation = new RegExp(confirmationPageSource, 'i').exec(text);
    if (confirmation) return { outcome: 'success', signal: 'confirmation-page', evidence: confirmation[0] };
    if (current !== initial && new RegExp(confirmationUrlSource, 'i').test(current)) return { outcome: 'success', signal: 'confirmation-url', evidence: current };
    if (selector && !form) return { outcome: 'success', signal: 'form-disappeared', evidence: 'Contact form disappeared after submission.' };
    if (initial && current !== initial) return { outcome: 'url-changed', signal: 'url-change', evidence: `${initial} -> ${current}` };
    return false;
  }, { timeout, polling: 250 }, { selector: formSelector, initial: initialUrl, successSource: SUCCESS.source, confirmationUrlSource: CONFIRMATION_URL.source, confirmationPageSource: CONFIRMATION_PAGE.source });
  return typeof handle?.jsonValue === 'function' ? handle.jsonValue() : handle;
}
