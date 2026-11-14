export const RESULT_STATUSES = Object.freeze({
  pending: { label: 'Pending', tone: 'neutral' },
  processing: { label: 'Processing', tone: 'info' },
  success: { label: 'Success', tone: 'success' },
  failed: { label: 'Failed', tone: 'error' },
  manual_review: { label: 'Manual review', tone: 'warning' },
  skipped: { label: 'Skipped', tone: 'neutral' },
});

// Plain-language explanation and next step for each failure / review code the backend reports.
export const FAILURE_HINTS = Object.freeze({
  DNS_FAILED: { label: 'Website unreachable', hint: 'The domain did not resolve. Check the URL is spelled correctly, or retry later.' },
  HTTP_ERROR: { label: 'Blocked or site error', hint: 'The site refused the visit (often bot protection). Open it and submit by hand.' },
  NAVIGATION_TIMEOUT: { label: 'Page too slow', hint: 'Increase the page timeout in Settings and retry.' },
  NAVIGATION_FAILED: { label: 'Could not open site', hint: 'The site did not load. Retry later.' },
  CONTACT_PAGE_NOT_FOUND: { label: 'No contact page', hint: 'No contact link was found. Paste the contact page URL directly into the sheet.' },
  FORM_NOT_FOUND: { label: 'No form found', hint: 'The page has no fillable form (it may use email/phone only or a chat widget).' },
  CAPTCHA: { label: 'CAPTCHA', hint: 'Run in Visible browser mode to solve the CAPTCHA by hand when prompted.' },
  AMBIGUOUS_REQUIRED_FIELD: { label: 'Unknown required field', hint: 'Add a custom field in Settings → Contact profile with this field name and a value.' },
  FILE_UPLOAD: { label: 'File upload', hint: 'The form needs an attachment; submit by hand.' },
  LEGAL_DECLARATION: { label: 'Consent checkbox', hint: 'The form requires agreeing to terms; review and submit by hand.' },
  MARKETING_CONSENT: { label: 'Marketing opt-in', hint: 'A marketing consent box is present; review by hand.' },
  LOGIN_REQUIRED: { label: 'Login required', hint: 'The form is behind a login.' },
  PAYMENT_FIELD: { label: 'Payment field', hint: 'Payment details are never filled automatically.' },
  UNSUPPORTED_MULTI_STEP: { label: 'Multi-step form', hint: 'Multi-step or scheduling forms need a person.' },
  FORM_FILL_FAILED: { label: 'Field fill failed', hint: 'A required field rejected the value. Open the screenshot to see which one.' },
  MANUAL_REVIEW: { label: 'Needs review', hint: 'The submission result was unclear. Check the screenshot before retrying.' },
  UNCERTAIN_PREVIOUS_SUBMISSION: { label: 'Possible duplicate', hint: 'A previous attempt may already have submitted.' },
  PROCESSING_ERROR: { label: 'Unexpected error', hint: 'Retry; if it repeats, check the backend logs.' },
});

export function failureCategory(result = {}) {
  if (!['failed', 'manual_review'].includes(result.status)) return null;
  const code = String(result.verificationEvidence ?? '').split(',').map((part) => part.trim()).find((part) => /^[A-Z][A-Z_]+$/.test(part));
  return code ?? (result.status === 'manual_review' ? 'MANUAL_REVIEW' : 'PROCESSING_ERROR');
}

export function describeFailure(code) {
  return FAILURE_HINTS[code] ?? { label: code ? code.replace(/_/g, ' ').toLowerCase() : 'Unknown', hint: '' };
}

export function summarizeFailures(results = []) {
  const counts = new Map();
  for (const result of results) { const code = failureCategory(result); if (code) counts.set(code, (counts.get(code) ?? 0) + 1); }
  return [...counts.entries()].map(([code, count]) => ({ code, count, ...describeFailure(code) })).sort((left, right) => right.count - left.count);
}

export const CAPTCHA_FILTERS = Object.freeze({
  any: 'Any CAPTCHA', none: 'No CAPTCHA', needs_person: 'Needs a person',
  text: 'Text CAPTCHA', math: 'Math CAPTCHA', recaptcha_v2: 'reCAPTCHA v2', hcaptcha: 'hCaptcha', turnstile: 'Cloudflare Turnstile',
});

export function captchaTypes(result = {}) { return String(result.captchaType ?? '').split(',').map((type) => type.trim()).filter(Boolean); }

export function matchesCaptchaFilter(result, filter = 'all') {
  if (!filter || filter === 'all') return true;
  const types = captchaTypes(result);
  if (filter === 'any') return types.length > 0;
  if (filter === 'none') return types.length === 0;
  if (filter === 'needs_person') return /needs a person/i.test(result.captcha ?? '');
  return types.includes(filter);
}

export function filterResults(results, { status = 'all', query = '', category = null, captcha = 'all' } = {}) {
  const normalizedQuery = query.trim().toLowerCase();
  return results.filter((result) => {
    const matchesStatus = status === 'all' || result.status === status;
    const matchesCategory = !category || failureCategory(result) === category;
    if (!matchesCaptchaFilter(result, captcha)) return false;
    const searchable = [result.url, result.contactPageUrl, result.reason, result.runId, result.captcha].filter(Boolean).join(' ').toLowerCase();
    return matchesStatus && matchesCategory && (!normalizedQuery || searchable.includes(normalizedQuery));
  });
}

export function summarizeResults(results) {
  const summary = { total: results.length, pending: 0, processing: 0, success: 0, failed: 0, manualReview: 0, skipped: 0 };
  for (const result of results) {
    const key = result.status === 'manual_review' ? 'manualReview' : result.status;
    if (key in summary) summary[key] += 1;
  }
  return summary;
}

const csvCell = (value) => `"${String(value ?? '').replace(/"/g, '""')}"`;
export function resultsToCsv(results = []) {
  const header = ['Row', 'Website', 'Contact page', 'Status', 'Category', 'CAPTCHA', 'Reason', 'Evidence', 'Attempts', 'Updated'];
  const rows = results.map((result) => [result.rowNumber, result.url, result.contactPageUrl, RESULT_STATUSES[result.status]?.label ?? result.status, failureCategory(result) ? describeFailure(failureCategory(result)).label : '', result.captcha ?? '', result.reason, result.verificationEvidence, result.attemptCount, result.timestamp]);
  return [header, ...rows].map((row) => row.map(csvCell).join(',')).join('\r\n');
}
