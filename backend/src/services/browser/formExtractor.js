const MIN_FORM_SCORE = 25;

export class FormNotFoundError extends Error {
  constructor(message = 'No reliable contact or quote form was found.') { super(message); this.name = 'FormNotFoundError'; this.code = 'FORM_NOT_FOUND'; this.stage = 'form_detection'; this.retryable = false; }
}

export function scoreForm(form) {
  const haystack = [form.id, form.name, form.action, form.ariaLabel, form.className, form.heading, form.text].filter(Boolean).join(' ').toLowerCase();
  let score = 0; const reasons = [];
  const add = (points, reason) => { score += points; reasons.push(reason); };
  if (/contact|quote|enquir|inquir|reach us|talk to us/.test(haystack)) add(35, 'contact-language');
  if (/search|newsletter|subscribe|login|sign in|comment/.test(haystack)) add(-45, 'non-contact-form');
  const fields = form.fields ?? [];
  const fieldText = fields.map((field) => [field.type, field.name, field.id, field.label, field.accessibleName, field.placeholder].join(' ')).join(' ').toLowerCase();
  if (/email/.test(fieldText)) add(18, 'email-field');
  if (/name/.test(fieldText)) add(12, 'name-field');
  if (/message|comment|enquir|inquir|details/.test(fieldText) || fields.some((field) => field.tag === 'textarea')) add(20, 'message-field');
  if (/company|organization|phone|mobile|subject/.test(fieldText)) add(8, 'contact-detail-field');
  if ((form.submitButtons ?? []).some((button) => /send|submit|contact|quote|enquir|request/.test(`${button.text} ${button.value}`.toLowerCase()))) add(12, 'contact-submit');
  const fillableCount = fields.filter((field) => field.fillable).length;
  if (fillableCount < 2) add(-25, 'too-few-fields');
  if (fillableCount >= 4) add(8, 'substantial-form');
  return { ...form, score, scoreReasons: reasons };
}

export function rankForms(forms = []) { return forms.map(scoreForm).sort((left, right) => right.score - left.score || left.index - right.index); }

export function selectContactForm(forms = []) {
  const ranked = rankForms(forms); const selected = ranked[0];
  if (!selected || selected.score < MIN_FORM_SCORE) throw new FormNotFoundError();
  return { selected, ranked };
}

function analyzeForm(form) {
  const signals = form.multiStepSignals ?? {};
  return { ...form, hasCaptcha: Boolean(form.hasCaptcha), unsupportedMultiStep: Boolean(signals.hasNextControl && (signals.stepContainerCount > 1 || signals.hasProgress || signals.hiddenRequiredCount > 0)) };
}

export async function extractForms({ page } = {}) {
  if (!page) throw new TypeError('A Puppeteer page is required.');
  const extracted = await page.evaluate(() => {
    const clean = (value) => String(value ?? '').replace(/\s+/g, ' ').trim();
    const textFromIds = (ids) => clean(String(ids ?? '').split(/\s+/).map((id) => document.getElementById(id)?.textContent).filter(Boolean).join(' '));
    const getLabel = (control) => clean(control.labels?.length ? [...control.labels].map((label) => label.textContent).join(' ') : control.closest('label')?.textContent);
    const accessibleName = (control) => clean(control.getAttribute('aria-label') || textFromIds(control.getAttribute('aria-labelledby')) || getLabel(control) || control.getAttribute('placeholder') || control.getAttribute('name'));
    const captchaSelector = 'iframe[src*="recaptcha"],iframe[src*="hcaptcha"],iframe[src*="turnstile"],.g-recaptcha,.h-captcha,.cf-turnstile,[data-sitekey]';
    const pageHasCaptcha = Boolean(document.querySelector(captchaSelector));
    const forms = [...document.forms].map((form, formIndex) => {
      const formSelector = form.id ? `#${CSS.escape(form.id)}` : `form:nth-of-type(${formIndex + 1})`;
      const controls = [...form.querySelectorAll('input,textarea,select,button')];
      const fieldElements = controls.filter((control) => !(control.tagName === 'BUTTON' || ['submit','button','reset','image'].includes((control.getAttribute('type') || '').toLowerCase())));
      const fields = fieldElements.map((control, fieldIndex) => {
        const tag = control.tagName.toLowerCase(); const type = tag === 'input' ? (control.getAttribute('type') || 'text').toLowerCase() : tag;
        return {
          index: fieldIndex, selector: control.id ? `#${CSS.escape(control.id)}` : control.getAttribute('name') ? `${formSelector} [name="${CSS.escape(control.getAttribute('name'))}"]` : `${formSelector} ${tag}:nth-of-type(${[...form.querySelectorAll(tag)].indexOf(control) + 1})`,
          tag, type, name: control.getAttribute('name') || '', id: control.id || '', label: getLabel(control), accessibleName: accessibleName(control),
          placeholder: control.getAttribute('placeholder') || '', autocomplete: control.getAttribute('autocomplete') || '', ariaDescribedBy: control.getAttribute('aria-describedby') || '',
          required: control.required || control.getAttribute('aria-required') === 'true', disabled: control.disabled, readOnly: control.readOnly, checked: ['checkbox','radio'].includes(type) ? control.checked : undefined,
          fillable: !control.disabled && !control.readOnly && !['hidden','submit','button','reset','image','file'].includes(type), isCustomDropdown: control.getAttribute('role') === 'combobox' || control.getAttribute('aria-haspopup') === 'listbox',
          options: tag === 'select' ? [...control.options].map((option) => ({ value: option.value, text: clean(option.textContent), disabled: option.disabled })) : [],
        };
      });
      const submitButtons = controls.filter((control) => control.tagName === 'BUTTON' ? (control.getAttribute('type') || 'submit').toLowerCase() === 'submit' : ['submit','image'].includes((control.getAttribute('type') || '').toLowerCase())).map((button, index) => ({ index, selector: button.id ? `#${CSS.escape(button.id)}` : `${formSelector} ${button.tagName.toLowerCase()}[type="${(button.getAttribute('type') || 'submit').toLowerCase()}"]:nth-of-type(${[...form.querySelectorAll(button.tagName)].indexOf(button) + 1})`, text: clean(button.textContent), value: button.value || '', id: button.id || '', name: button.getAttribute('name') || '', disabled: button.disabled, accessibleName: accessibleName(button) }));
      const nextControls = controls.filter((control) => /^(next|continue|proceed)$/i.test(clean(control.textContent || control.value || control.getAttribute('aria-label'))));
      const stepContainers = form.querySelectorAll('[data-step],.form-step,.step-pane,[aria-label*="step" i]');
      const hiddenRequiredCount = fields.filter((field) => field.required && fieldElements[field.index] && (fieldElements[field.index].hidden || fieldElements[field.index].getAttribute('aria-hidden') === 'true')).length;
      const heading = clean(form.querySelector('h1,h2,h3,legend,[role="heading"]')?.textContent);
      const validationMessages = [...form.querySelectorAll('[role="alert"],[aria-live],.error,.invalid-feedback,.field-error')].map((element) => clean(element.textContent)).filter(Boolean).slice(0, 20);
      return {
        index: formIndex, selector: formSelector, id: form.id || '', name: form.getAttribute('name') || '',
        action: form.action || '', method: (form.method || 'get').toLowerCase(), ariaLabel: form.getAttribute('aria-label') || '', className: form.className || '', heading, text: clean(form.innerText).slice(0, 500),
        fields, submitButtons, validationMessages, hasCaptcha: Boolean(form.querySelector(captchaSelector)),
        multiStepSignals: { hasNextControl: nextControls.length > 0, stepContainerCount: stepContainers.length, hasProgress: Boolean(form.querySelector('progress,[role="progressbar"],[aria-label*="step" i]')), hiddenRequiredCount },
      };
    });
    return { forms, pageHasCaptcha };
  });
  const analyzed = extracted.forms.map(analyzeForm);
  const { selected, ranked } = selectContactForm(analyzed);
  return { forms: ranked, selectedForm: selected, pageHasCaptcha: extracted.pageHasCaptcha, hasCaptcha: extracted.pageHasCaptcha || selected.hasCaptcha, unsupportedMultiStep: selected.unsupportedMultiStep };
}
