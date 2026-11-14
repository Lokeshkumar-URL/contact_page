import assert from 'node:assert/strict';
import { test } from 'node:test';
import { FormNotFoundError, extractForms, rankForms, scoreForm, selectContactForm } from '../src/services/browser/formExtractor.js';

const contactForm = {
  index: 1, selector: '#contact-form', id: 'contact-form', name: 'contact', action: 'https://example.com/contact', method: 'post', ariaLabel: 'Contact us', className: 'contact-form', heading: 'Get in touch', text: 'Contact our team',
  fields: [
    { index: 0, selector: '#full-name', tag: 'input', type: 'text', name: 'fullName', id: 'full-name', label: 'Full name', accessibleName: 'Full name', placeholder: 'Patrick Joe', required: true, disabled: false, readOnly: false, fillable: true, options: [] },
    { index: 1, selector: '#email', tag: 'input', type: 'email', name: 'email', id: 'email', label: 'Work email', accessibleName: 'Work email', placeholder: 'name@company.com', required: true, disabled: false, readOnly: false, fillable: true, options: [] },
    { index: 2, selector: '#topic', tag: 'select', type: 'select', name: 'topic', id: 'topic', label: 'Topic', accessibleName: 'Topic', required: true, disabled: false, readOnly: false, fillable: true, options: [{ value: 'quote', text: 'Get a quote', disabled: false }] },
    { index: 3, selector: '#message', tag: 'textarea', type: 'textarea', name: 'message', id: 'message', label: 'Message', accessibleName: 'Message', required: true, disabled: false, readOnly: false, fillable: true, options: [] },
    { index: 4, selector: '#phone-ok', tag: 'input', type: 'checkbox', name: 'phoneOk', id: 'phone-ok', label: 'Call me', accessibleName: 'Call me', required: false, disabled: false, readOnly: false, checked: false, fillable: true, options: [] },
    { index: 5, selector: '#method-email', tag: 'input', type: 'radio', name: 'method', id: 'method-email', label: 'Email', accessibleName: 'Email', required: false, disabled: false, readOnly: false, checked: true, fillable: true, options: [] },
  ],
  submitButtons: [{ index: 0, text: 'Send enquiry', value: '', id: 'submit', name: '', disabled: false, accessibleName: 'Send enquiry' }],
  validationMessages: ['Email is required'], hasCaptcha: false,
  multiStepSignals: { hasNextControl: false, stepContainerCount: 0, hasProgress: false, hiddenRequiredCount: 0 },
};

test('form scoring selects the contact form when multiple forms exist', () => {
  const search = { index: 0, id: 'search', action: '/search', text: 'Search', fields: [{ tag: 'input', type: 'search', name: 'q', fillable: true }], submitButtons: [{ text: 'Search', value: '' }] };
  const ranked = rankForms([search, contactForm]);
  assert.equal(ranked[0].id, 'contact-form'); assert.ok(ranked[0].score > ranked[1].score);
  assert.equal(selectContactForm([search, contactForm]).selected.id, 'contact-form');
  assert.ok(scoreForm(contactForm).score >= 25);
});

test('extraction preserves field metadata, options, controls, and validation messages', async () => {
  const page = { evaluate: async () => ({ forms: [contactForm], pageHasCaptcha: false }) };
  const result = await extractForms({ page });
  assert.equal(result.selectedForm.id, 'contact-form');
  assert.equal(result.selectedForm.fields.find((field) => field.type === 'email').required, true);
  assert.deepEqual(result.selectedForm.fields.find((field) => field.tag === 'select').options, [{ value: 'quote', text: 'Get a quote', disabled: false }]);
  assert.equal(result.selectedForm.fields.find((field) => field.type === 'checkbox').checked, false);
  assert.equal(result.selectedForm.fields.find((field) => field.type === 'radio').checked, true);
  assert.equal(result.selectedForm.submitButtons[0].text, 'Send enquiry');
  assert.deepEqual(result.selectedForm.validationMessages, ['Email is required']);
});

test('CAPTCHA and unsupported multi-step forms are detected explicitly', async () => {
  const riskyForm = { ...contactForm, hasCaptcha: true, multiStepSignals: { hasNextControl: true, stepContainerCount: 3, hasProgress: true, hiddenRequiredCount: 1 } };
  const result = await extractForms({ page: { evaluate: async () => ({ forms: [riskyForm], pageHasCaptcha: true }) } });
  assert.equal(result.hasCaptcha, true); assert.equal(result.selectedForm.hasCaptcha, true);
  assert.equal(result.unsupportedMultiStep, true); assert.equal(result.selectedForm.unsupportedMultiStep, true);
});

test('a Next button alone does not create a false multi-step classification', async () => {
  const simple = { ...contactForm, multiStepSignals: { hasNextControl: true, stepContainerCount: 0, hasProgress: false, hiddenRequiredCount: 0 } };
  const result = await extractForms({ page: { evaluate: async () => ({ forms: [simple], pageHasCaptcha: false }) } });
  assert.equal(result.unsupportedMultiStep, false);
});

test('missing or unrelated forms produce a typed non-retryable failure', async () => {
  assert.throws(() => selectContactForm([]), (error) => error instanceof FormNotFoundError && error.code === 'FORM_NOT_FOUND' && error.retryable === false);
  const search = { index: 0, id: 'search', action: '/search', text: 'Search', fields: [{ tag: 'input', type: 'search', name: 'q', fillable: true }], submitButtons: [{ text: 'Search' }] };
  await assert.rejects(() => extractForms({ page: { evaluate: async () => ({ forms: [search], pageHasCaptcha: false }) } }), FormNotFoundError);
});

test('embedded form providers are inspected when the main page has no contact form', async () => {
  const search = { index: 0, id: 'search', action: '/search', text: 'Search', fields: [{ tag: 'input', type: 'search', name: 'q', fillable: true }], submitButtons: [{ text: 'Search' }] };
  const frame = { url: () => 'https://www.emailmeform.com/builder/embed/example', evaluate: async () => ({ forms: [contactForm], pageHasCaptcha: false }) };
  const page = { url: () => 'https://example.com/contact', evaluate: async () => ({ forms: [search], pageHasCaptcha: false }), mainFrame: () => page, frames: () => [page,frame] };
  const result = await extractForms({ page, timeout: 1 });
  assert.equal(result.selectedForm.id, 'contact-form');
  assert.equal(result.context, frame);
  assert.match(result.frameUrl, /emailmeform/);
});

test('custom date and time schedulers require manual review instead of reporting no form', async () => {
  const page={waitForFunction:async()=>{throw new Error('none');},evaluate:async()=>({forms:[],pageHasCaptcha:false,unsupportedScheduling:true})};
  await assert.rejects(()=>extractForms({page,timeout:1}),(error)=>error.code==='MANUAL_REVIEW'&&error.reasons[0].code==='UNSUPPORTED_MULTI_STEP');
});
