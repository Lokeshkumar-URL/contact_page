import assert from 'node:assert/strict';
import { test } from 'node:test';
import { classifySubmissionState, verifySubmission } from '../src/services/browser/submissionVerifier.js';

test('thank-you messages and confirmation pages are reliable success evidence', () => {
  assert.equal(classifySubmissionState({ bodyText: 'Thank you, your message has been sent.' }).signal, 'thank-you-message');
  assert.equal(classifySubmissionState({ bodyText: 'Your request confirmed. Reference number 123.' }).signal, 'confirmation-page');
});

test('confirmation URLs, form disappearance, and unrelated URL changes are distinguished', () => {
  assert.equal(classifySubmissionState({ currentUrl: 'https://example.com/thank-you', initialUrl: 'https://example.com/contact' }).signal, 'confirmation-url');
  assert.equal(classifySubmissionState({ currentUrl: 'https://example.com/contact', initialUrl: 'https://example.com/contact', formPresent: false }).signal, 'form-disappeared');
  const changed = classifySubmissionState({ currentUrl: 'https://example.com/home', initialUrl: 'https://example.com/contact' }); assert.equal(changed.outcome, 'url-changed'); assert.equal(changed.signal, 'url-change');
});

test('validation errors take priority over weaker navigation and disappearance signals', () => {
  const result = classifySubmissionState({ currentUrl: 'https://example.com/home', initialUrl: 'https://example.com/contact', formPresent: false, validationMessages: ['Email is required'] });
  assert.equal(result.outcome, 'validation-error'); assert.equal(result.evidence, 'Email is required');
});

test('browser verifier returns the detected evidence handle', async () => {
  const page = { waitForFunction: async (_callback, options, input) => { assert.equal(options.polling, 250); assert.equal(input.initial, 'https://example.com/contact'); return { jsonValue: async () => ({ outcome: 'success', signal: 'form-disappeared', evidence: 'Contact form disappeared after submission.' }) }; } };
  const result = await verifySubmission(page, { formSelector: '#contact', initialUrl: 'https://example.com/contact', timeout: 500 });
  assert.equal(result.signal, 'form-disappeared');
});

test('CAPTCHA rejection takes priority over unrelated thank-you text', () => {
  const result = classifySubmissionState({ bodyText: 'Thank you for visiting', validationMessages: ['CAPTCHA: The reCAPTCHA was invalid. Go back and try it again.'] });
  assert.equal(result.outcome, 'validation-error');
  assert.match(result.evidence, /reCAPTCHA was invalid/);
});

test('visible Gravity Forms rejection outside the form prevents false confirmation', async () => {
  const { runInNewContext } = await import('node:vm');
  const page = { waitForFunction: async (callback, options, input) => {
    const error = { offsetWidth: 200, textContent: 'CAPTCHA: The reCAPTCHA was invalid.' };
    const result = runInNewContext(`(${callback.toString()})(input)`, {
      input, window: { location: { href: 'https://example.com/thank-you' } },
      document: { body: { innerText: 'Thank you for visiting' }, readyState: 'complete', querySelector: () => null,
        querySelectorAll: (selector) => selector.includes('.gform_validation_errors') ? [error] : [] },
    });
    return { jsonValue: async () => result };
  } };
  const result = await verifySubmission(page, { formSelector: '#contact', initialUrl: 'https://example.com/contact', timeout: 500 });
  assert.equal(result.outcome, 'validation-error');
  assert.match(result.evidence, /reCAPTCHA was invalid/);
});
