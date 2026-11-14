import assert from 'node:assert/strict';
import { test } from 'node:test';
import puppeteer from 'puppeteer';
import { FASTCAPTCHA_OCR_URL, solveImageCaptchaFastCaptcha } from '../src/services/captcha/fastCaptchaClient.js';
import { solveFormImageCaptcha } from '../src/services/captcha/imageCaptchaSolver.js';
import { findManualReviewReasons } from '../src/services/browser/manualReview.js';
import { mapFields } from '../src/services/browser/fieldMapper.js';
import { extractForms } from '../src/services/browser/formExtractor.js';
import { processWebsite } from '../src/services/automation/websiteProcessor.js';

const jsonResponse = (status, body) => ({ ok: status >= 200 && status < 300, status, json: async () => body });

test('FastCaptcha client posts base64 image with API key header and returns solved text', async () => {
  let request;
  const fetchImpl = async (url, init) => { request = { url, init }; return jsonResponse(200, { success: true, text: ' AB12C ', credits_remaining: 99 }); };
  const result = await solveImageCaptchaFastCaptcha('data:image/png;base64,QUJD', { apiKey: 'key-1', fetchImpl, solvingEnabled: true });
  assert.equal(result.text, 'AB12C'); assert.equal(result.creditsRemaining, 99);
  assert.equal(request.url, FASTCAPTCHA_OCR_URL); assert.equal(request.init.headers['X-API-Key'], 'key-1');
  assert.deepEqual(JSON.parse(request.init.body), { base64_image: 'QUJD' });
});

test('FastCaptcha client throws a typed error on failure without leaking the key', async () => {
  const fetchImpl = async () => jsonResponse(401, { success: false, error_code: 'INVALID_API_KEY' });
  await assert.rejects(() => solveImageCaptchaFastCaptcha('QUJD', { apiKey: 'secret-key', fetchImpl, solvingEnabled: true }), (error) => error.code === 'FASTCAPTCHA_FAILED' && /INVALID_API_KEY/.test(error.message) && !/secret-key/.test(error.message));
  await assert.rejects(() => solveImageCaptchaFastCaptcha('QUJD', { solvingEnabled: true }), /not configured/);
});

const captchaForm = { imageCaptcha: { inputSelector: '#captcha', imageSelector: '[data-contact-automation-captcha="0"]' }, fields: [
  { selector: '#email', type: 'email', label: 'Email', required: true, fillable: true },
  { selector: '#captcha', type: 'text', label: 'Enter the code shown', required: true, fillable: true, isCaptcha: true },
] };

test('image CAPTCHA passes the safety gate only when it can be solved', () => {
  const mappings = [{ selector: '#email', value: 'a@example.com', confidence: 1 }];
  assert.deepEqual(findManualReviewReasons({ form: captchaForm, mappings, imageCaptchaSolvable: true }), []);
  assert.deepEqual(findManualReviewReasons({ form: captchaForm, mappings }).map((reason) => reason.code), ['CAPTCHA']);
  // Widget CAPTCHAs (reCAPTCHA/hCaptcha/Turnstile) still always require a person.
  assert.equal(findManualReviewReasons({ form: { ...captchaForm, hasCaptcha: true }, mappings, imageCaptchaSolvable: true })[0].code, 'CAPTCHA');
});

test('field mapper never maps a CAPTCHA input to profile data', () => {
  const result = mapFields([{ index: 0, selector: '#captcha', type: 'text', label: 'Security code', name: 'code', fillable: true, isCaptcha: true }], { email: 'a@example.com' });
  assert.equal(result.mappings.length, 0); assert.equal(result.ignored[0].reason, 'captcha');
});

test('solver falls back to MANUAL_REVIEW when no API key and no manual entry window', async () => {
  const page = { $: async () => null };
  await assert.rejects(() => solveFormImageCaptcha({ page, captcha: captchaForm.imageCaptcha }), (error) => error.code === 'MANUAL_REVIEW' && error.reasons[0].code === 'CAPTCHA' && /not configured/.test(error.message));
});

test('pipeline runs the CAPTCHA solver after filling and reports the method', async () => {
  const calls = []; const page = { current: 'about:blank', url() { return this.current; } };
  const manager = { createPage: async () => page, safeClosePage: async () => {} };
  const form = { selector: '#contact', ...captchaForm, submitButtons: [{ selector: '#send', text: 'Send' }] };
  const services = {
    navigateSafely: async ({ url }) => { page.current = url; }, closeCommonPopups: async () => {}, createSafeContactLinkFallback: () => null, createSafeSubmitControlFallback: () => null,
    findContactPage: async () => ({ url: 'https://example.com/contact', method: 'rules' }), extractForms: async () => ({ forms: [form], selectedForm: form, context: page }),
    mapFieldsWithClaudeFallback: async () => ({ mappings: [], unresolved: [] }),
    fillForm: async (args) => { calls.push(['fill', args.imageCaptchaSolvable]); return { filled: [] }; },
    solveFormImageCaptcha: async (args) => { calls.push(['captcha', args.apiKey, args.captcha.inputSelector]); return { method: 'fastcaptcha' }; },
    captureScreenshot: async () => { calls.push(['screenshot']); return 'shot.png'; }, submitForm: async () => ({ verificationEvidence: 'skipped' }),
  };
  const result = await processWebsite({ url: 'https://example.com', rowNumber: 2 }, { config: { dryRun: true }, browserManager: manager, services, captchaSettings: { apiKey: 'key-1', solvingEnabled: true } });
  assert.deepEqual(calls, [['fill', true], ['captcha', 'key-1', '#captcha'], ['screenshot']]);
  assert.equal(result.metrics.captchaMethod, 'fastcaptcha');
});

const html = `<!doctype html><form id="contact-form" action="/contact"><h2>Contact us</h2>
<label for="name">Your name</label><input id="name" name="name" required>
<label for="email">Email</label><input id="email" name="email" type="email" required>
<label for="message">Message</label><textarea id="message" name="message" required></textarea>
<div class="captcha-row"><img id="captchaImg" width="150" height="50" alt="security image" src="data:image/svg+xml;base64,${Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="150" height="50"><rect width="150" height="50" fill="#eee"/><text x="20" y="35" font-size="28">X7K2P</text></svg>').toString('base64')}">
<label for="sec">Enter the code shown</label><input id="sec" name="security_code" required></div>
<button type="submit">Send message</button></form>`;

test('real browser: detects an image CAPTCHA, captures it, solves it, and types the answer', async (t) => {
  let browser;
  try { browser = await puppeteer.launch({ headless: true }); } catch (error) { t.skip(`Chrome unavailable: ${error.message}`); return; }
  try {
    const page = await browser.newPage(); await page.setContent(html);
    const extracted = await extractForms({ page, timeout: 1000 });
    const { imageCaptcha } = extracted.selectedForm;
    assert.equal(imageCaptcha.inputSelector, '#sec');
    assert.equal(await page.$eval(imageCaptcha.imageSelector, (element) => element.id), 'captchaImg');
    assert.equal(extracted.selectedForm.fields.find((field) => field.selector === '#sec').isCaptcha, true);
    let sentImage = '';
    const result = await solveFormImageCaptcha({ page, captcha: imageCaptcha, solvingEnabled: true, apiKey: 'key-1', solve: async (image) => { sentImage = image; return { text: 'X7K2P' }; } });
    assert.equal(result.method, 'fastcaptcha');
    assert.ok(Buffer.from(sentImage, 'base64').subarray(1, 4).toString() === 'PNG', 'captured element as PNG');
    assert.equal(await page.$eval('#sec', (element) => element.value), 'X7K2P');
    // FastCaptcha failure falls back to MANUAL_REVIEW when manual entry is off.
    await assert.rejects(() => solveFormImageCaptcha({ page, captcha: imageCaptcha, solvingEnabled: true, apiKey: 'key-1', solve: async () => { throw Object.assign(new Error('FastCaptcha solve failed: HTTP 500'), { code: 'FASTCAPTCHA_FAILED' }); } }), (error) => error.code === 'MANUAL_REVIEW' && /HTTP 500/.test(error.message));
    // Manual entry fallback: a person types the code in the visible browser.
    page.waitForFunction(() => document.querySelector('#sec').style.outline !== '', { timeout: 5000 }).then(() => page.type('#sec', 'HUMAN1')).catch(() => {});
    const manual = await solveFormImageCaptcha({ page, captcha: imageCaptcha, solvingEnabled: true, apiKey: 'key-1', manualEntryTimeoutMs: 5000, solve: async () => { throw new Error('down'); } });
    assert.equal(manual.method, 'manual');
  } finally { await browser.close(); }
});

test('FastCaptcha remains opt-in and makes no request by default', async () => {
  let called = false;
  await assert.rejects(solveImageCaptchaFastCaptcha('QUJD', {
    apiKey: 'test', fetchImpl: async () => { called = true; },
  }), /disabled/);
  assert.equal(called, false);
});
