const MARKETING = /marketing|newsletter|subscribe|promotional|offers|opt[ -]?in/;
const LEGAL = /terms|conditions|privacy|legal|declaration|certif|authorize|consent|agree|acknowledge/;
const LOGIN = /login|log in|sign in|account password|member portal/;
const PAYMENT = /payment|credit card|debit card|card number|cvv|cvc|billing|expiry|expiration/;

export class ManualReviewError extends Error {
  constructor(reasons, message = 'This form requires manual review before submission.') {
    super(message); this.name = 'ManualReviewError'; this.code = 'MANUAL_REVIEW'; this.stage = 'safety_review'; this.retryable = false; this.reasons = reasons; this.details = reasons;
  }
}

const fieldText = (field = {}) => [field.label, field.accessibleName, field.name, field.id, field.placeholder].filter(Boolean).join(' ').toLowerCase();

export function findManualReviewReasons({ form = {}, mappings = [], pageHasCaptcha = false, previousSubmissionUncertain = false } = {}) {
  const reasons = [];
  const fields = form.fields ?? [];
  const add = (code, message, selector = '') => { if (!reasons.some((reason) => reason.code === code && reason.selector === selector)) reasons.push({ code, message, selector }); };
  if (pageHasCaptcha || form.hasCaptcha) add('CAPTCHA', 'CAPTCHA requires a person and will not be bypassed.');
  if (form.unsupportedMultiStep) add('UNSUPPORTED_MULTI_STEP', 'The form uses an unsupported multi-step flow.');
  if (previousSubmissionUncertain) add('UNCERTAIN_PREVIOUS_SUBMISSION', 'A previous submission may have occurred.');
  for (const field of fields) {
    const text = fieldText(field); const selector = field.selector ?? '';
    if (field.type === 'file') add('FILE_UPLOAD', 'File uploads require manual review.', selector);
    if (field.type === 'password' || LOGIN.test(text)) add('LOGIN_REQUIRED', 'Login or account credentials are required.', selector);
    if (PAYMENT.test(text) || ['cc-number','cc-csc','cc-exp','cc-exp-month','cc-exp-year'].includes(field.autocomplete)) add('PAYMENT_FIELD', 'Payment information must never be filled automatically.', selector);
    if (['checkbox','radio'].includes(field.type) && MARKETING.test(text)) add('MARKETING_CONSENT', 'Marketing consent will not be accepted automatically.', selector);
    if (['checkbox','radio'].includes(field.type) && LEGAL.test(text)) add('LEGAL_DECLARATION', 'Legal consent or declarations require a person.', selector);
  }
  const mappedSelectors = new Set(mappings.filter((mapping) => mapping.value !== undefined && mapping.value !== null && mapping.value !== '').map((mapping) => mapping.selector));
  for (const field of fields.filter((candidate) => candidate.required && candidate.fillable !== false)) {
    const mapping = mappings.find((candidate) => candidate.selector === field.selector);
    if (!mappedSelectors.has(field.selector) || mapping?.ambiguous === true || (Number.isFinite(mapping?.confidence) && mapping.confidence < 0.8)) add('AMBIGUOUS_REQUIRED_FIELD', 'A required field could not be mapped with confidence.', field.selector);
  }
  return reasons;
}

export function assertSafeForAutomation(context) {
  const reasons = findManualReviewReasons(context);
  if (reasons.length) throw new ManualReviewError(reasons);
  return { safe: true, reasons: [] };
}
