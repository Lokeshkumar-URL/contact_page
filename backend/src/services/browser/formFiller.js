import { assertSafeForAutomation } from './manualReview.js';

const UNSAFE_CHECKBOX = /consent|agree|terms|privacy|marketing|newsletter|subscribe|opt[ -]?in|authorize|permission/;

const fieldName = (mapping = {}) => { const field = mapping.field ?? {}; return field.label || field.accessibleName || field.placeholder || field.name || mapping.selector || 'field'; };

export class FormFillError extends Error {
  constructor(message, details = []) { super(message); this.name = 'FormFillError'; this.code = 'FORM_FILL_FAILED'; this.stage = 'form_filling'; this.retryable = false; this.details = details; }
}

const normalize = (value) => String(value ?? '').trim().toLowerCase().replace(/\s+/g, ' ');
const KEYBOARD_TYPES = new Set(['text','email','tel','url','search']);

export async function validateFilledValues(page, mappings = []) {
  const checks = mappings.filter((mapping) => mapping.selector && mapping.value !== undefined && mapping.value !== null && mapping.field?.type !== 'checkbox');
  if (!checks.length) return [];
  return page.evaluate((items) => items.map((item) => {
    const element = document.querySelector(item.selector);
    if (!element) return { selector: item.selector, valid: false, reason: 'field-not-found-after-fill' };
    const expected = String(item.expected ?? '').trim(); const type = String(item.type ?? '').toLowerCase();
    if (type === 'radio') {
      const selected = element.name ? [...document.querySelectorAll('input[type="radio"]')].find((radio) => radio.name === element.name && radio.checked) : element.checked ? element : null;
      return { selector: item.selector, valid: Boolean(selected) && String(selected.value).trim().toLowerCase() === expected.toLowerCase(), reason: 'radio-value-mismatch' };
    }
    const actual = String(element.value ?? '').trim();
    return { selector: item.selector, valid: actual === expected || (element.tagName === 'SELECT' && String(element.selectedOptions?.[0]?.textContent ?? '').trim().toLowerCase() === expected.toLowerCase()), reason: 'value-mismatch', actual };
  }), checks.map((mapping) => ({ selector: mapping.selector, expected: mapping.field?.tag === 'select' ? (resolveSelectOption(mapping)?.value ?? mapping.value) : mapping.value, type: mapping.field?.type })));
}

export function chooseSelectOption(options = [], desiredValue) {
  const desired = normalize(desiredValue); if (!desired) return null;
  const available = options.filter((option) => !option.disabled);
  return available.find((option) => normalize(option.value) === desired)
    ?? available.find((option) => normalize(option.text) === desired)
    ?? available.find((option) => normalize(option.text).startsWith(`${desired} -`) || normalize(option.text).endsWith(` (${desired})`))
    ?? null;
}

const GENERAL_OPTION = /general|inquiry|enquiry|question|sales|business|partnership|other/i;
const PLACEHOLDER_OPTION = /^(select|choose|please select|--|-|pick)/i;
// For subject/purpose dropdowns, fall back to a neutral "General inquiry"-style option when the profile value is not listed.
export function resolveSelectOption(mapping) {
  const options = mapping.field?.options ?? [];
  const exact = chooseSelectOption(options, mapping.value); if (exact) return exact;
  if (!['subject','contactPurpose'].includes(mapping.profileKey)) return null;
  const usable = options.filter((option) => !option.disabled && String(option.value ?? '').trim() && !PLACEHOLDER_OPTION.test(String(option.text ?? '').trim()));
  return usable.find((option) => /general/i.test(option.text)) ?? usable.find((option) => GENERAL_OPTION.test(option.text)) ?? null;
}

export function isSafeCheckboxMapping(mapping) {
  const field = mapping.field ?? {}; const text = [field.label, field.accessibleName, field.name, field.id].filter(Boolean).join(' ').toLowerCase();
  return mapping.approved === true && mapping.value === true && !UNSAFE_CHECKBOX.test(text);
}

async function fillNativeControl(page, mapping) {
  const field = mapping.field ?? {}; const type = String(field.type ?? '').toLowerCase();
  if (type === 'checkbox' && !isSafeCheckboxMapping(mapping)) return { status: 'skipped', reason: 'unsafe-checkbox' };
  const selectedOption = field.tag === 'select' ? resolveSelectOption(mapping) : null;
  if (field.tag === 'select' && !selectedOption) return { status: 'failed', reason: 'select-option-not-found' };
  const keyboardField = field.tag === 'textarea' || KEYBOARD_TYPES.has(type);
  if (keyboardField && typeof page.type === 'function') {
    const desired = String(mapping.value);
    const readValue = () => page.evaluate((selector) => document.querySelector(selector)?.value ?? null, mapping.selector);
    const clear = async () => {
      await page.click(mapping.selector, { clickCount: 3 });
      if (page.keyboard?.press) await page.keyboard.press('Backspace');
      else await page.evaluate((selector) => { const element=document.querySelector(selector);if(element){element.value='';element.dispatchEvent(new Event('input',{bubbles:true}));} }, mapping.selector);
    };
    try {
      // Some pages swallow the first keystroke right after focus (scripts still settling, focus animations),
      // which turned "Patrick" into "atrick". Verify, retry once after a pause, then set the value directly.
      for (let attempt = 1; attempt <= 2; attempt += 1) {
        await clear();
        if (attempt > 1) await new Promise((resolve) => setTimeout(resolve, 300));
        await page.type(mapping.selector, desired, { delay: attempt > 1 ? 25 : 5 });
        const current = await readValue(); if (typeof current !== 'string' || current === desired) break;
      }
      return page.evaluate(({ selector, desiredValue }) => {
        const element = document.querySelector(selector); if (!element) return { status: 'failed', reason: 'field-not-found' };
        if (element.value !== desiredValue) {
          const prototype = element.tagName === 'TEXTAREA' ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
          const setter = Object.getOwnPropertyDescriptor(prototype, 'value')?.set; setter ? setter.call(element, desiredValue) : element.value = desiredValue;
          element.dispatchEvent(new Event('input', { bubbles: true })); element.dispatchEvent(new Event('change', { bubbles: true }));
        }
        element.blur();
        return element.value === desiredValue ? { status: 'filled' } : { status: 'failed', reason: 'value-rejected' };
      }, { selector: mapping.selector, desiredValue: desired });
    } catch { return { status: 'failed', reason: 'keyboard-entry-failed' }; }
  }
  return page.evaluate(({ selector, desiredValue, optionValue, approvedCheckbox }) => {
    const element = document.querySelector(selector); if (!element) return { status: 'failed', reason: 'field-not-found' };
    const emit = (target) => { target.dispatchEvent(new Event('input', { bubbles: true })); target.dispatchEvent(new Event('change', { bubbles: true })); target.dispatchEvent(new Event('blur', { bubbles: true })); };
    if (element.tagName === 'SELECT') { const setter = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value')?.set; setter ? setter.call(element, optionValue) : element.value = optionValue; emit(element); return element.value === optionValue ? { status: 'filled' } : { status: 'failed', reason: 'select-value-rejected' }; }
    if (element.type === 'checkbox') { if (!approvedCheckbox) return { status: 'skipped', reason: 'unsafe-checkbox' }; const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'checked')?.set; setter ? setter.call(element, true) : element.checked = true; emit(element); return { status: 'filled' }; }
    if (element.type === 'radio') { const radios = element.name ? [...document.querySelectorAll('input[type="radio"]')].filter((radio) => radio.name === element.name) : [element]; const target = radios.find((radio) => normalizeValue(radio.value) === normalizeValue(desiredValue)); if (!target) return { status: 'failed', reason: 'radio-option-not-found' }; const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'checked')?.set; setter ? setter.call(target, true) : target.checked = true; emit(target); return { status: 'filled' }; }
    const prototype = element.tagName === 'TEXTAREA' ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype; const setter = Object.getOwnPropertyDescriptor(prototype, 'value')?.set; setter ? setter.call(element, String(desiredValue)) : element.value = String(desiredValue); emit(element); return element.value === String(desiredValue) ? { status: 'filled' } : { status: 'failed', reason: 'value-rejected' };
    function normalizeValue(value) { return String(value ?? '').trim().toLowerCase(); }
  }, { selector: mapping.selector, desiredValue: mapping.value, optionValue: selectedOption?.value, approvedCheckbox: type === 'checkbox' && isSafeCheckboxMapping(mapping) });
}

async function fillCustomDropdown(page, mapping, timeout) {
  await page.click(mapping.selector);
  await page.waitForFunction((desired) => [...document.querySelectorAll('[role="option"],[data-option],.option')].some((option) => (option.textContent || '').trim().toLowerCase() === String(desired).trim().toLowerCase()), { timeout }, mapping.value);
  return page.evaluate((desired) => { const option = [...document.querySelectorAll('[role="option"],[data-option],.option')].find((item) => (item.textContent || '').trim().toLowerCase() === String(desired).trim().toLowerCase()); if (!option) return { status: 'failed', reason: 'custom-option-not-found' }; option.click(); return { status: 'filled' }; }, mapping.value);
}

async function fillOne(page, mapping, timeout) {
  if (!mapping.selector || mapping.value === undefined || mapping.value === null) return { status: 'failed', reason: 'invalid-mapping' };
  try { await page.waitForSelector(mapping.selector, { visible: true, timeout }); } catch { return { status: 'pending', reason: 'field-not-found' }; }
  if (mapping.field?.isCustomDropdown) { try { return await fillCustomDropdown(page, mapping, timeout); } catch { return { status: 'pending', reason: 'custom-dropdown-not-ready' }; } }
  return fillNativeControl(page, mapping);
}

/**
 * Last guard immediately before submit: some sites reset or rewrite fields seconds after filling
 * (late scripts, re-rendered forms, pop-ups). Check every filled value, refill anything changed,
 * wait briefly to catch a delayed reset, and check again. A required field that still does not
 * hold its value stops the run, so a blank or wrong form is never sent.
 */
export async function ensureFieldsStillFilled({ page, mappings = [], timeout = 3000, settleMs = 1000, rounds = 2 } = {}) {
  if (!page || !mappings.length) return { refilled: [] };
  const bySelector = new Map(mappings.map((mapping) => [mapping.selector, mapping])); const refilled = new Set(); let invalid = [];
  for (let round = 0; round <= rounds; round += 1) {
    invalid = (await validateFilledValues(page, mappings)).filter((check) => !check.valid);
    if (!invalid.length) {
      if (round === rounds || settleMs <= 0) break;
      await new Promise((resolve) => setTimeout(resolve, settleMs)); continue; // re-check after a pause to catch late resets
    }
    if (round === rounds) break;
    for (const check of invalid) { const mapping = bySelector.get(check.selector); if (mapping) { await fillOne(page, mapping, timeout); refilled.add(check.selector); } }
  }
  const invalidRequired = invalid.filter((check) => bySelector.get(check.selector)?.field?.required);
  if (invalidRequired.length) throw new FormFillError(`Required field(s) did not retain the expected value before submit: ${invalidRequired.map((check) => `${fieldName(bySelector.get(check.selector))}${check.actual !== undefined ? ` (got "${String(check.actual).slice(0, 40)}")` : ''}`).join(', ')}.`, invalidRequired);
  return { refilled: [...refilled] };
}

export async function fillForm({ page, mappings = [], form, pageHasCaptcha = false, previousSubmissionUncertain = false, imageCaptchaSolvable = false, widgetCaptchaSolvable = false, mathCaptchaSolvable = false, discoverDynamicMappings, timeout = 3000 } = {}) {
  if (!page) throw new TypeError('A Puppeteer page is required.');
  if (form) assertSafeForAutomation({ form, mappings, pageHasCaptcha, previousSubmissionUncertain, imageCaptchaSolvable, widgetCaptchaSolvable, mathCaptchaSolvable });
  const known = new Map(mappings.map((mapping) => [mapping.selector, mapping])); const results = new Map(); let dynamicPasses = 0;
  for (let pass = 0; pass <= 2; pass += 1) {
    for (const mapping of known.values()) {
      if (['filled','skipped'].includes(results.get(mapping.selector)?.status)) continue;
      results.set(mapping.selector, { mapping, ...(await fillOne(page, mapping, timeout)) });
    }
    const pending = [...results.values()].filter((result) => result.status === 'pending');
    if ((!pending.length && !discoverDynamicMappings) || pass === 2) break;
    dynamicPasses += 1; const discovered = await discoverDynamicMappings?.({ pass: pass + 1, filled: [...results.values()] }) ?? [];
    for (const mapping of discovered) if (!known.has(mapping.selector)) known.set(mapping.selector, mapping);
  }
  const all = [...results.values()]; const failed = all.filter((result) => ['failed','pending'].includes(result.status)); const requiredFailures = failed.filter((result) => result.mapping.field?.required);
  if (requiredFailures.length) throw new FormFillError(`Required field(s) could not be filled: ${requiredFailures.map(({ mapping, reason }) => `${fieldName(mapping)} (${reason})`).join(', ')}.`, requiredFailures.map(({ mapping, reason }) => ({ selector: mapping.selector, reason })));
  const filled = all.filter((result) => result.status === 'filled');
  let validation = await validateFilledValues(page, filled.map((result) => result.mapping));
  let invalidRequired = validation.filter((check) => !check.valid && known.get(check.selector)?.field?.required);
  if (invalidRequired.length) {
    // Some sites reset their form when late scripts finish loading, wiping values typed moments earlier.
    // Fill the affected fields once more, then validate again before giving up.
    for (const check of invalidRequired) { const mapping = known.get(check.selector); if (mapping) await fillOne(page, mapping, timeout); }
    validation = await validateFilledValues(page, filled.map((result) => result.mapping));
    invalidRequired = validation.filter((check) => !check.valid && known.get(check.selector)?.field?.required);
  }
  if (invalidRequired.length) throw new FormFillError(`Required field(s) did not retain the expected value: ${invalidRequired.map((check) => `${fieldName(known.get(check.selector) ?? { selector: check.selector })}${check.actual !== undefined ? ` (got "${String(check.actual).slice(0, 40)}")` : ''}`).join(', ')}.`, invalidRequired);
  return { filled, skipped: all.filter((result) => result.status === 'skipped'), failed, validation, dynamicPasses };
}
