import { ManualReviewError } from './manualReview.js';

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

async function extractFormsFromContext(page, timeout) {
  if (!page) throw new TypeError('A Puppeteer page is required.');
  if (typeof page.waitForFunction === 'function') {
    try {
      await page.waitForFunction(() => [...document.forms].some((form) => {
        const fields = form.querySelectorAll('input:not([type="hidden"]),textarea,select').length;
        const text = `${form.innerText || ''} ${form.id} ${form.className} ${form.action}`.toLowerCase();
        return fields >= 2 && (form.querySelector('textarea') || /contact|message|quote|enquir|inquir|sales/.test(text));
      }) || [...document.querySelectorAll('textarea,input[type="email"]')].some((field) => !field.closest('form')), { timeout, polling: 250 });
    } catch { /* Extract the available forms and report a typed failure below. */ }
  }
  const extracted = await page.evaluate(() => {
    const clean = (value) => String(value ?? '').replace(/\s+/g, ' ').trim();
    const textFromIds = (ids) => clean(String(ids ?? '').split(/\s+/).map((id) => document.getElementById(id)?.textContent).filter(Boolean).join(' '));
    const getLabel = (control) => clean(control.labels?.length ? [...control.labels].map((label) => label.textContent).join(' ') : control.closest('label')?.textContent);
    const accessibleName = (control) => clean(control.getAttribute('aria-label') || textFromIds(control.getAttribute('aria-labelledby')) || getLabel(control) || control.getAttribute('placeholder') || control.getAttribute('name'));
    // Only CAPTCHAs a person must interact with block automation. Invisible reCAPTCHA v3 / invisible
    // hCaptcha are scored by the site itself on submit, exactly as for any visitor.
    const captchaSelector = 'iframe[src*="recaptcha"],iframe[src*="hcaptcha"],iframe[src*="turnstile"],iframe[src*="challenges.cloudflare.com"],.g-recaptcha,.h-captcha,.cf-turnstile,[data-sitekey]';
    const isVisible = (element) => { const box = element.getBoundingClientRect(); const style = getComputedStyle(element); return box.width > 20 && box.height > 20 && style.visibility !== 'hidden' && style.display !== 'none' && style.opacity !== '0'; };
    const isInvisibleCaptcha = (element) => /size=invisible|\/bframe/.test(element.getAttribute('src') || '') || element.getAttribute('data-size') === 'invisible' || Boolean(element.closest('.grecaptcha-badge,[data-size="invisible"]'));
    const interactiveCaptchas = (root) => [...root.querySelectorAll(captchaSelector)].filter((element) => !isInvisibleCaptcha(element) && isVisible(element));
    const pageHasCaptcha = interactiveCaptchas(document).length > 0;
    const captchaKind = (root) => { const found = interactiveCaptchas(root).map((element) => `${element.className} ${element.getAttribute('src') || ''}`).join(' '); return /turnstile|cloudflare/.test(found) ? 'turnstile' : /hcaptcha|h-captcha/.test(found) ? 'hcaptcha' : found ? 'recaptcha' : null; };
    // Many modern sites build contact forms from <div>s without a <form> element; treat the smallest
    // container holding the message/email field, two or more inputs, and a button as a form.
    const containers = [...document.forms];
    for (const anchor of document.querySelectorAll('textarea,input[type="email"]')) {
      if (anchor.closest('form')) continue;
      let node = anchor.parentElement;
      for (let depth = 0; node && node !== document.body && depth < 8; depth += 1, node = node.parentElement) {
        if (node.querySelectorAll('input:not([type="hidden"]),textarea,select').length >= 2 && node.querySelector('button,input[type="submit"],input[type="button"],[role="button"]')) break;
      }
      if (node && node !== document.body && !containers.some((existing) => existing === node || existing.contains(node) || node.contains(existing))) containers.push(node);
    }
    const pageText = clean(document.body?.innerText).toLowerCase();
    const unsupportedScheduling = /what time works best|select (?:your )?(?:preferred )?date.{0,80}time|meeting duration|choose a time|schedule (?:your |a )?(?:free )?demo/.test(pageText);
    const forms = containers.map((form, formIndex) => {
      form.setAttribute('data-contact-automation-form', String(formIndex));
      const formSelector = form.id ? `#${CSS.escape(form.id)}` : `form[data-contact-automation-form="${formIndex}"]`;
      const controls = [...form.querySelectorAll('input,textarea,select,button,[role="button"]')].filter((control) => control.tagName !== 'BUTTON' || !control.closest('[role="listbox"],[role="menu"]'));
      const fieldElements = controls.filter((control) => ['INPUT','TEXTAREA','SELECT'].includes(control.tagName) && !['submit','button','reset','image'].includes((control.getAttribute('type') || '').toLowerCase()));
      const fields = fieldElements.map((control, fieldIndex) => {
        const tag = control.tagName.toLowerCase(); const type = tag === 'input' ? (control.getAttribute('type') || 'text').toLowerCase() : tag;
        const groupLabel = clean(control.closest('fieldset')?.querySelector('legend')?.textContent || control.closest('[role="group"],[role="radiogroup"]')?.getAttribute('aria-label'));
        control.setAttribute('data-contact-automation-field', `${formIndex}-${fieldIndex}`);
        return {
          index: fieldIndex, selector: control.id ? `#${CSS.escape(control.id)}` : control.getAttribute('name') ? `${formSelector} [name="${CSS.escape(control.getAttribute('name'))}"]${['radio','checkbox'].includes(type)&&control.value?`[value="${CSS.escape(control.value)}"]`:''}` : `[data-contact-automation-field="${formIndex}-${fieldIndex}"]`,
          tag, type, name: control.getAttribute('name') || '', id: control.id || '', label: getLabel(control), groupLabel, accessibleName: accessibleName(control),
          placeholder: control.getAttribute('placeholder') || '', autocomplete: control.getAttribute('autocomplete') || '', ariaDescribedBy: control.getAttribute('aria-describedby') || '',
          required: control.required || control.getAttribute('aria-required') === 'true', disabled: control.disabled, readOnly: control.readOnly, checked: ['checkbox','radio'].includes(type) ? control.checked : undefined,
          fillable: !control.disabled && !control.readOnly && !['hidden','submit','button','reset','image','file'].includes(type), isCustomDropdown: control.getAttribute('role') === 'combobox' || control.getAttribute('aria-haspopup') === 'listbox',
          options: tag === 'select' ? [...control.options].map((option) => ({ value: option.value, text: clean(option.textContent), disabled: option.disabled })) : [],
        };
      });
      const isRealSubmit = (control) => control.tagName === 'BUTTON' ? (control.getAttribute('type') || 'submit').toLowerCase() === 'submit' : control.tagName === 'INPUT' && ['submit','image'].includes((control.getAttribute('type') || '').toLowerCase());
      // JavaScript-driven forms often use type="button" or role="button"; accept those only when no real submit exists and the label clearly submits.
      const scriptSubmitText = /\b(send|submit)\b|get in touch|contact us|request (?:a )?(?:quote|demo|info|information|callback)|book (?:a )?demo|get (?:a )?quote/i;
      const realSubmits = controls.filter(isRealSubmit);
      // ASP.NET / DotNetNuke and older sites submit through a link styled as a button,
      // e.g. <a href="javascript:__doPostBack(...)">Submit</a>; accept those when the label clearly submits.
      const linkSubmitText = /^(submit|send|send message|send enquiry|send inquiry|submit form|submit message|submit request|send request)$/i;
      const scriptLinks = [...form.querySelectorAll('a[href^="javascript:" i],a[onclick]')].filter((link) => !controls.includes(link) && linkSubmitText.test(clean(link.textContent || link.getAttribute('aria-label'))));
      const scriptControls = [...controls, ...scriptLinks].filter((control) => (control.tagName === 'BUTTON' || control.tagName === 'A' || control.getAttribute('role') === 'button' || (control.tagName === 'INPUT' && control.type === 'button')) && scriptSubmitText.test(clean(control.textContent || control.value || control.getAttribute('aria-label'))));
      const submitButtons = (realSubmits.length ? realSubmits : scriptControls).map((button, index) => {
        button.setAttribute('data-contact-automation-submit', `${formIndex}-${index}`);
        const selector = button.id ? `#${CSS.escape(button.id)}` : `[data-contact-automation-submit="${formIndex}-${index}"]`;
        return { index, selector, text: clean(button.textContent), value: button.value || '', id: button.id || '', name: button.getAttribute('name') || '', disabled: button.disabled, accessibleName: accessibleName(button) };
      });
      // Text/image CAPTCHA: a text input labelled as a CAPTCHA/security code plus a small image near it.
      const captchaText = /captcha|security code|verification code|security check|anti[- ]?spam code|enter (?:the )?(?:code|characters|text|letters)|type (?:the )?(?:code|characters|text|letters)|code (?:shown|above|below)/i;
      const isCodeInput = (control) => { const type = (control.getAttribute('type') || 'text').toLowerCase(); return control.tagName === 'INPUT' && ['text','tel','number',''].includes(type) && !control.disabled && !control.readOnly; };
      // Text that belongs to this input only: the element right before it, or its own wrapper when it wraps no other field.
      const nearbyText = (control) => {
        const previous = control.previousElementSibling; const parent = control.parentElement;
        const previousText = previous && !previous.matches('input,textarea,select') && !previous.querySelector('input,textarea,select') ? clean(previous.innerText || previous.textContent) : '';
        const parentText = parent && parent.querySelectorAll('input:not([type="hidden"]),textarea,select').length === 1 ? clean(parent.innerText || parent.textContent) : '';
        return `${previousText} ${parentText}`.slice(0, 200);
      };
      const captchaNameToken = /(^|[^a-z])(cpt|capt|captcha|securitycode|security_code|verifycode|verify_code|vcode)([^a-z]|$)/i;
      let captchaFieldIndex = fieldElements.findIndex((control) => isCodeInput(control) && (captchaText.test([control.getAttribute('name'), control.id, control.className, control.getAttribute('placeholder'), control.getAttribute('aria-label'), getLabel(control)].filter(Boolean).join(' ')) || captchaNameToken.test(`${control.getAttribute('name') || ''} ${control.id}`)));
      if (captchaFieldIndex < 0) captchaFieldIndex = fieldElements.findIndex((control) => isCodeInput(control) && captchaText.test(nearbyText(control)));
      // Last resort: a short code box (maxlength <= 10) sharing a wrapper with an image explicitly marked as a CAPTCHA.
      if (captchaFieldIndex < 0) captchaFieldIndex = fieldElements.findIndex((control) => {
        const maxLength = Number(control.getAttribute('maxlength') || 0);
        return isCodeInput(control) && maxLength > 0 && maxLength <= 10 && Boolean(control.parentElement?.querySelector('img[alt*="captcha" i],img[src*="captcha" i],img[id*="captcha" i]'));
      });
      let imageCaptcha = null;
      if (captchaFieldIndex >= 0) {
        const input = fieldElements[captchaFieldIndex];
        const plausible = (element) => {
          const box = element.getBoundingClientRect();
          // An image still downloading reports 0x0; accept it when it is explicitly a CAPTCHA image.
          if (element.tagName === 'IMG' && !element.complete && /captcha/i.test(`${element.getAttribute('src')} ${element.alt} ${element.id} ${element.className}`)) return true;
          return box.width >= 40 && box.width <= 400 && box.height >= 15 && box.height <= 150;
        };
        const near = []; let container = input.parentElement;
        for (let depth = 0; container && depth < 4 && container !== form.parentElement; depth += 1, container = container.parentElement) near.push(...container.querySelectorAll('img,canvas'));
        const candidates = [...form.querySelectorAll('img[id*="captcha" i],img[src*="captcha" i],img[alt*="captcha" i],img[class*="captcha" i],canvas[id*="captcha" i],canvas[class*="captcha" i]'), ...near];
        const image = candidates.find(plausible);
        if (image) {
          image.setAttribute('data-contact-automation-captcha', String(formIndex));
          fields[captchaFieldIndex].isCaptcha = true;
          imageCaptcha = { inputSelector: fields[captchaFieldIndex].selector, imageSelector: `[data-contact-automation-captcha="${formIndex}"]` };
        }
      }
      // Math CAPTCHA: a short input next to a small arithmetic question ("What is 3 + 4?", "seven plus two =").
      // The question text is returned to Node, which parses it safely; nothing in the page is evaluated.
      const mathHint = /what is|what's|solve|sum|math|calculate|captcha|answer|result|security question|are you human|prove you|=\s*\??|\?\s*$/i;
      const mathPattern = /\b(\d{1,3}|zero|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|thirteen|fourteen|fifteen|sixteen|seventeen|eighteen|nineteen|twenty)\s*(\+|plus|added to|-|−|–|minus|less|x|×|\*|times|multiplied by|\/|÷|divided by)\s*(\d{1,3}|zero|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|thirteen|fourteen|fifteen|sixteen|seventeen|eighteen|nineteen|twenty)\b/i;
      const questionFor = (control) => {
        const ownText = [getLabel(control), control.getAttribute('placeholder'), control.getAttribute('aria-label')].filter(Boolean).join(' ');
        // Only text that belongs to this field: its own wrapper (if it wraps no other field) or the element just before it.
        const parent = control.parentElement;
        const containerText = parent && parent.querySelectorAll('input:not([type="hidden"]),textarea,select').length === 1 ? clean(parent.innerText || parent.textContent).slice(0, 160) : '';
        const previous = control.previousElementSibling; const previousText = previous && !previous.matches('input,textarea,select') && !previous.querySelector('input,textarea,select') ? clean(previous.innerText || previous.textContent).slice(0, 160) : '';
        return [ownText, previousText, containerText].map(clean).find((text) => text && text.length <= 160 && mathPattern.test(text) && mathHint.test(text)) || '';
      };
      let mathCaptcha = null;
      fieldElements.forEach((control, index) => {
        if (mathCaptcha || control.tagName !== 'INPUT' || !['text','number',''].includes((control.getAttribute('type') || 'text').toLowerCase())) return;
        if (imageCaptcha && fields[index].selector === imageCaptcha.inputSelector) return;
        const question = questionFor(control);
        if (question) { fields[index].isCaptcha = true; mathCaptcha = { inputSelector: fields[index].selector, question }; }
      });
      // An image CAPTCHA whose instructions ask for a calculation shows a sum as a picture ("3 + 4 =").
      if (imageCaptcha) {
        const input = fieldElements[captchaFieldIndex];
        const instructions = clean([getLabel(input), input.getAttribute('placeholder'), input.parentElement?.innerText].filter(Boolean).join(' ')).slice(0, 200);
        if (/solve|sum|math|calculat|result of|answer to|add the|arithmetic/i.test(instructions)) imageCaptcha.math = true;
      }
      const nextControls = controls.filter((control) => /^(next|continue|proceed)$/i.test(clean(control.textContent || control.value || control.getAttribute('aria-label'))));
      const stepContainers = form.querySelectorAll('[data-step],.form-step,.step-pane,[aria-label*="step" i]');
      const hiddenRequiredCount = fields.filter((field) => field.required && fieldElements[field.index] && (fieldElements[field.index].hidden || fieldElements[field.index].getAttribute('aria-hidden') === 'true')).length;
      const heading = clean(form.querySelector('h1,h2,h3,legend,[role="heading"]')?.textContent);
      const validationMessages = [...form.querySelectorAll('[role="alert"],[aria-live],.error,.invalid-feedback,.field-error')].map((element) => clean(element.textContent)).filter(Boolean).slice(0, 20);
      return {
        index: formIndex, selector: formSelector, id: form.id || '', name: form.getAttribute('name') || '',
        action: form.action || '', method: (form.method || 'get').toLowerCase(), ariaLabel: form.getAttribute('aria-label') || '', className: form.className || '', heading, text: clean(form.innerText).slice(0, 500),
        fields, submitButtons, validationMessages, hasCaptcha: interactiveCaptchas(form).length > 0, captchaKind: captchaKind(form), imageCaptcha, mathCaptcha, formless: form.tagName !== 'FORM',
        multiStepSignals: { hasNextControl: nextControls.length > 0, stepContainerCount: stepContainers.length, hasProgress: Boolean(form.querySelector('progress,[role="progressbar"],[aria-label*="step" i]')), hiddenRequiredCount },
      };
    });
    return { forms, pageHasCaptcha, pageCaptchaKind: captchaKind(document), unsupportedScheduling };
  });
  const analyzed = extracted.forms.map(analyzeForm);
  if (!analyzed.length && extracted.unsupportedScheduling) throw new ManualReviewError([{ code: 'UNSUPPORTED_MULTI_STEP', message: 'The page uses a date/time scheduling flow that requires an explicitly approved appointment slot.', selector: '' }]);
  const { selected, ranked } = selectContactForm(analyzed);
  return { forms: ranked, selectedForm: selected, pageHasCaptcha: extracted.pageHasCaptcha, hasCaptcha: extracted.pageHasCaptcha || selected.hasCaptcha, captchaKind: selected.captchaKind ?? extracted.pageCaptchaKind ?? null, unsupportedMultiStep: selected.unsupportedMultiStep, context: page, frameUrl: typeof page.url === 'function' ? page.url() : '' };
}

const FORM_FRAME_URL = /emailmeform|hubspot|hsforms|jotform|typeform|formstack|marketo|pardot|salesforce|wufoo|cognitoforms|zohopublic|forms\.zoho|123formbuilder|paperform|tally\.so|formsite|pipedrive|webforms|forms\./i;
const NON_FORM_FRAME_URL = /recaptcha|hcaptcha|challenges\.cloudflare|youtube|vimeo|google\.com\/maps|maps\.google|doubleclick|googletagmanager|googlesyndication|facebook|twitter|linkedin\.com\/(?!.*form)|stripe|intercom|drift|zendesk|hotjar|calendly/i;

export async function extractForms({ page, timeout = 5000 } = {}) {
  if (!page) throw new TypeError('A Puppeteer page is required.');
  const contexts = [{ context: page, timeout }];
  if (typeof page.frames === 'function') {
    const main = page.mainFrame?.();
    for (const frame of page.frames()) {
      const url = frame.url?.() ?? '';
      if (frame === main || !/^https?:/i.test(url) || NON_FORM_FRAME_URL.test(url)) continue;
      // Known form providers get the full wait; any other embedded frame gets a quick look.
      if (contexts.length < 10) contexts.push({ context: frame, timeout: FORM_FRAME_URL.test(url) ? timeout : Math.min(timeout, 1500) });
    }
  }
  const candidates = [];
  for (const { context, timeout: contextTimeout } of contexts) {
    try { candidates.push(await extractFormsFromContext(context, contextTimeout)); }
    catch (error) { if (!(error instanceof FormNotFoundError) && context === page) throw error; }
  }
  if (!candidates.length) throw new FormNotFoundError();
  return candidates.sort((left,right)=>right.selectedForm.score-left.selectedForm.score)[0];
}
