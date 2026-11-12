import assert from 'node:assert/strict';
import { test } from 'node:test';
import { ManualReviewError, assertSafeForAutomation, findManualReviewReasons } from '../src/services/browser/manualReview.js';

const field = (selector, type, label, extra = {}) => ({ selector, type, label, fillable: !['file','password'].includes(type), required: false, ...extra });

test('all unsafe form categories produce explicit manual-review reasons', () => {
  const form = { hasCaptcha: true, unsupportedMultiStep: true, fields: [
    field('#marketing', 'checkbox', 'Subscribe to marketing'), field('#terms', 'checkbox', 'I agree to legal terms'),
    field('#upload', 'file', 'Upload brief'), field('#password', 'password', 'Account password'),
    field('#card', 'text', 'Credit card number'), field('#unknown', 'text', 'Reference', { required: true, fillable: true }),
  ] };
  const codes = findManualReviewReasons({ form, previousSubmissionUncertain: true }).map((reason) => reason.code);
  assert.deepEqual(new Set(codes), new Set(['CAPTCHA','UNSUPPORTED_MULTI_STEP','UNCERTAIN_PREVIOUS_SUBMISSION','MARKETING_CONSENT','LEGAL_DECLARATION','FILE_UPLOAD','LOGIN_REQUIRED','PAYMENT_FIELD','AMBIGUOUS_REQUIRED_FIELD']));
});

test('complete ordinary forms pass the safety gate', () => {
  const form = { fields: [field('#email', 'email', 'Email address', { required: true, fillable: true })] };
  assert.deepEqual(assertSafeForAutomation({ form, mappings: [{ selector: '#email', value: 'person@example.com', confidence: 1 }] }), { safe: true, reasons: [] });
});

test('CAPTCHA and legal consent stop with the existing MANUAL_REVIEW code', () => {
  assert.throws(() => assertSafeForAutomation({ form: { hasCaptcha: true, fields: [field('#terms', 'checkbox', 'Accept terms')] } }), (error) => error instanceof ManualReviewError && error.code === 'MANUAL_REVIEW' && error.retryable === false);
});
