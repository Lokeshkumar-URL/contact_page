import assert from 'node:assert/strict';
import { test } from 'node:test';
import { FormFillError, chooseSelectOption, fillForm, isSafeCheckboxMapping } from '../src/services/browser/formFiller.js';
import { ManualReviewError } from '../src/services/browser/manualReview.js';

const mapping = (selector, overrides = {}) => ({ selector, value: 'Example value', field: { selector, tag: 'input', type: 'text', required: false, label: '', accessibleName: '', name: '', id: '', options: [], ...overrides.field }, ...overrides });

function mockPage({ missing = new Set() } = {}) {
  const calls = { wait: [], evaluate: [], click: [], type: [], keys: [], waitForFunction: 0 };
  return {
    calls,
    waitForSelector: async (selector) => { calls.wait.push(selector); if (missing.has(selector)) throw new Error('missing'); return {}; },
    evaluate: async (_callback, argument) => { calls.evaluate.push(argument); return Array.isArray(argument) ? argument.map((item) => ({ selector: item.selector, valid: true })) : { status: 'filled' }; },
    click: async (selector, options) => calls.click.push({ selector, options }),
    type: async (selector, value, options) => calls.type.push({ selector, value, options }),
    keyboard: { press: async (key) => calls.keys.push(key) },
    waitForFunction: async () => { calls.waitForFunction += 1; },
  };
}

test('select matching supports values, visible text, and state-code labels', () => {
  const options = [{ value: '', text: 'Choose', disabled: true }, { value: 'DE', text: 'Delaware (DE)', disabled: false }, { value: 'sales', text: 'Sales enquiry', disabled: false }];
  assert.equal(chooseSelectOption(options, 'DE').value, 'DE');
  assert.equal(chooseSelectOption(options, 'Sales enquiry').value, 'sales');
  assert.equal(chooseSelectOption(options, 'missing'), null);
});

test('text, email, telephone, textarea, select, and radio mappings are filled', async () => {
  const page = mockPage();
  const mappings = [
    mapping('#name'), mapping('#email', { value: 'person@example.com', field: { type: 'email' } }),
    mapping('#phone', { value: '+1 555 0100', field: { type: 'tel' } }),
    mapping('#message', { field: { tag: 'textarea', type: 'textarea' } }),
    mapping('#state', { value: 'DE', field: { tag: 'select', type: 'select', options: [{ value: 'DE', text: 'Delaware', disabled: false }] } }),
    mapping('#role', { value: 'owner', field: { type: 'radio' } }),
  ];
  const result = await fillForm({ page, mappings });
  assert.equal(result.filled.length, 6); assert.equal(result.failed.length, 0);
  assert.deepEqual(page.calls.wait, mappings.map((item) => item.selector));
  assert.deepEqual(page.calls.type.map((item) => item.selector), ['#name','#email','#phone','#message']);
  assert.equal(page.calls.keys.length, 4);
});

test('checkboxes require explicit approval and consent checkboxes stay blocked', async () => {
  const safe = mapping('#updates', { value: true, approved: true, field: { type: 'checkbox', label: 'Include a copy with my request' } });
  const consent = mapping('#terms', { value: true, approved: true, field: { type: 'checkbox', label: 'I agree to marketing terms' } });
  const unapproved = mapping('#optional', { value: true, field: { type: 'checkbox', label: 'Optional setting' } });
  assert.equal(isSafeCheckboxMapping(safe), true); assert.equal(isSafeCheckboxMapping(consent), false); assert.equal(isSafeCheckboxMapping(unapproved), false);
  const result = await fillForm({ page: mockPage(), mappings: [consent, unapproved] });
  assert.equal(result.skipped.length, 2); assert.ok(result.skipped.every((item) => item.reason === 'unsafe-checkbox'));
});

test('custom dropdowns use visible options through bounded browser interactions', async () => {
  const page = mockPage(); const custom = mapping('#custom-state', { value: 'Delaware', field: { isCustomDropdown: true } });
  const result = await fillForm({ page, mappings: [custom], timeout: 500 });
  assert.equal(result.filled.length, 1); assert.equal(page.calls.click[0].selector, '#custom-state'); assert.equal(page.calls.waitForFunction, 1);
});

test('new dynamic fields can be discovered and filled in a later pass', async () => {
  const page = mockPage(); let discoveries = 0;
  const result = await fillForm({ page, mappings: [mapping('#initial')], discoverDynamicMappings: async () => { discoveries += 1; return discoveries === 1 ? [mapping('#late-field')] : []; } });
  assert.equal(result.filled.length, 2); assert.equal(result.dynamicPasses, 2); assert.ok(page.calls.wait.includes('#late-field'));
});

test('an unavailable required field produces a typed non-retryable failure', async () => {
  const required = mapping('#required', { field: { required: true } });
  await assert.rejects(() => fillForm({ page: mockPage({ missing: new Set(['#required']) }), mappings: [required], timeout: 1 }), (error) => error instanceof FormFillError && error.code === 'FORM_FILL_FAILED' && error.details[0].selector === '#required');
});

test('a required value rejected after filling produces a typed failure', async () => {
  const page = mockPage(); page.evaluate = async (_callback, argument) => Array.isArray(argument) ? argument.map((item) => ({ selector: item.selector, valid: false, reason: 'value-mismatch' })) : { status: 'filled' };
  await assert.rejects(() => fillForm({ page, mappings: [mapping('#email', { value: 'person@example.com', field: { type: 'email', required: true } })] }), (error) => error instanceof FormFillError && /retain/.test(error.message));
});

test('manual-review risks stop before any field is filled', async () => {
  const page = mockPage();
  await assert.rejects(() => fillForm({ page, form: { hasCaptcha: true, fields: [] }, mappings: [] }), (error) => error instanceof ManualReviewError && error.code === 'MANUAL_REVIEW');
  assert.equal(page.calls.wait.length, 0); assert.equal(page.calls.evaluate.length, 0);
});
