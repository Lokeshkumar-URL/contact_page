import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import puppeteer from 'puppeteer';
import { classifyCaptchas, describeCaptcha, solveMathQuestion } from '../src/services/captcha/captchaClassifier.js';
import { solveFormImageCaptcha, solveMathCaptcha } from '../src/services/captcha/imageCaptchaSolver.js';
import { findManualReviewReasons } from '../src/services/browser/manualReview.js';
import { extractForms } from '../src/services/browser/formExtractor.js';
import { processWebsite } from '../src/services/automation/websiteProcessor.js';

let browser; let browserError;
before(async () => { try { browser = await puppeteer.launch({ headless: true }); } catch (error) { browserError = error; } });
after(async () => { await browser?.close(); });
async function withPage(t, html, run) {
  if (!browser) { t.skip(`Chrome unavailable: ${browserError?.message}`); return; }
  const page = await browser.newPage(); try { await page.setContent(html); await run(page); } finally { await page.close(); }
}

test('math questions are answered with plain arithmetic, never code evaluation', () => {
  assert.equal(solveMathQuestion('What is 3 + 4?'), '7');
  assert.equal(solveMathQuestion('seven minus two ='), '5');
  assert.equal(solveMathQuestion('12 x 3'), '36');
  assert.equal(solveMathQuestion('Solve: 8 ÷ 2'), '4');
  assert.equal(solveMathQuestion('7 / 2'), null, 'non-integer answers are refused');
  assert.equal(solveMathQuestion('process.exit(1)'), null);
  assert.equal(solveMathQuestion('Enter your name'), null);
});

test('every CAPTCHA type is classified and reported by name', () => {
  assert.deepEqual(classifyCaptchas({ form: { imageCaptcha: {} } }), ['text']);
  assert.deepEqual(classifyCaptchas({ form: { imageCaptcha: { math: true } } }), ['math']);
  assert.deepEqual(classifyCaptchas({ form: { mathCaptcha: { question: '1+1' } } }), ['math']);
  assert.deepEqual(classifyCaptchas({ form: { hasCaptcha: true, captchaKind: 'recaptcha' } }), ['recaptcha_v2']);
  assert.deepEqual(classifyCaptchas({ form: { hasCaptcha: true, captchaKind: 'hcaptcha' } }), ['hcaptcha']);
  assert.deepEqual(classifyCaptchas({ pageHasCaptcha: true, captchaKind: 'turnstile' }), ['turnstile']);
  assert.equal(describeCaptcha(['text'], { text: 'fastcaptcha' }), 'Text CAPTCHA – solved by FastCaptcha');
  assert.equal(describeCaptcha(['recaptcha_v2', 'text'], { text: 'fastcaptcha' }), 'reCAPTCHA v2 (checkbox) – needs a person; Text CAPTCHA – solved by FastCaptcha');
  assert.equal(describeCaptcha(['turnstile']), 'Cloudflare Turnstile – needs a person');
});

test('manual-review reasons name the CAPTCHA type', () => {
  const reason = (form, extra = {}) => findManualReviewReasons({ form: { fields: [], ...form }, ...extra }).find((item) => item.code === 'CAPTCHA')?.message ?? '';
  assert.match(reason({ hasCaptcha: true, captchaKind: 'hcaptcha' }), /^hCaptcha detected – needs a person/);
  assert.match(reason({ hasCaptcha: true, captchaKind: 'turnstile' }), /^Cloudflare Turnstile detected/);
  assert.match(reason({ hasCaptcha: true, captchaKind: 'recaptcha' }), /^reCAPTCHA v2 \(checkbox\) detected/);
  assert.match(reason({ mathCaptcha: { question: 'What is 2+2?', inputSelector: '#m' } }), /^Math CAPTCHA detected/);
  assert.equal(reason({ mathCaptcha: { question: 'What is 2+2?', inputSelector: '#m' } }, { mathCaptchaSolvable: true }), '');
});

const form = (extra) => `<form id="c"><h2>Contact us</h2><label for="n">Name</label><input id="n"><label for="e">Email</label><input id="e" type="email">
  <label for="p">Phone (call 1-800 ?)</label><input id="p" type="tel"><textarea id="msg" placeholder="Message"></textarea>${extra}<button>Send</button></form>`;

test('real browser: text math CAPTCHA is detected and answered', async (t) => {
  await withPage(t, form('<label for="q">What is 3 + 4?</label><input id="q" name="quiz" required>'), async (page) => {
    const { selectedForm } = await extractForms({ page, timeout: 1000 });
    assert.equal(selectedForm.mathCaptcha.inputSelector, '#q');
    assert.equal(selectedForm.fields.find((field) => field.selector === '#p').isCaptcha, undefined, 'phone field is not mistaken for a sum');
    const result = await solveMathCaptcha({ page, captcha: selectedForm.mathCaptcha, solvingEnabled: true });
    assert.equal(result.method, 'math'); assert.equal(await page.$eval('#q', (element) => element.value), '7');
    await assert.rejects(() => solveMathCaptcha({ page, captcha: selectedForm.mathCaptcha, autoAnswer: false }), (error) => error.code === 'MANUAL_REVIEW');
  });
});

test('real browser: math image CAPTCHA is read by FastCaptcha then calculated', async (t) => {
  const svg = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="120" height="40"><text x="10" y="28" font-size="24">6 + 5 =</text></svg>').toString('base64');
  await withPage(t, form(`<img id="cap" class="captcha" width="120" height="40" src="data:image/svg+xml;base64,${svg}"><label for="s">Solve the sum shown (security code)</label><input id="s" name="captcha_code">`), async (page) => {
    const { selectedForm } = await extractForms({ page, timeout: 1000 });
    assert.equal(selectedForm.imageCaptcha.math, true);
    const result = await solveFormImageCaptcha({ page, captcha: selectedForm.imageCaptcha, solvingEnabled: true, apiKey: 'k', solve: async () => ({ text: '6+5=' }) });
    assert.equal(result.method, 'fastcaptcha'); assert.equal(await page.$eval('#s', (element) => element.value), '11');
  });
});

test('pipeline reports the CAPTCHA type and outcome on success and on manual review', async () => {
  const page = { current: 'about:blank', url() { return this.current; } };
  const manager = { createPage: async () => page, safeClosePage: async () => {} };
  const baseForm = { selector: '#c', fields: [], submitButtons: [{ selector: '#s', text: 'Send' }] };
  const services = (formOverride, extractedExtra = {}) => ({
    navigateSafely: async ({ url }) => { page.current = url; }, closeCommonPopups: async () => {}, createSafeContactLinkFallback: () => null, createSafeSubmitControlFallback: () => null,
    findContactPage: async () => ({ url: 'https://example.com/contact', method: 'rules' }), extractForms: async () => ({ forms: [formOverride], selectedForm: formOverride, context: page, ...extractedExtra }),
    mapFieldsWithClaudeFallback: async () => ({ mappings: [], unresolved: [] }), getApprovedCustomFields: async () => [], recordFieldSuggestions: async () => {},
    fillForm: async (args) => { if (args.pageHasCaptcha && !args.widgetCaptchaSolvable) throw Object.assign(new Error('Manual review required'), { code: 'MANUAL_REVIEW' }); return { filled: [] }; },
    solveFormImageCaptcha: async () => ({ method: 'fastcaptcha' }), solveMathCaptcha: async () => ({ method: 'math' }), ensureFieldsStillFilled: async () => ({}),
    captureScreenshot: async () => 'shot.png', submitForm: async () => ({ verificationEvidence: 'skipped' }),
  });
  const ok = await processWebsite({ url: 'https://example.com', rowNumber: 2 }, { config: { dryRun: true }, browserManager: manager, services: services({ ...baseForm, imageCaptcha: { inputSelector: '#x', imageSelector: '#i' } }), captchaSettings: { apiKey: 'k', solvingEnabled: true } });
  assert.equal(ok.captcha, 'Text CAPTCHA – solved by FastCaptcha'); assert.equal(ok.captchaType, 'text');
  await assert.rejects(() => processWebsite({ url: 'https://example.com', rowNumber: 3 }, { config: { dryRun: true, browserMode: 'headless' }, browserManager: manager, services: services({ ...baseForm, hasCaptcha: true, captchaKind: 'hcaptcha' }, { pageHasCaptcha: true, captchaKind: 'hcaptcha' }) }),
    (error) => error.captcha === 'hCaptcha – needs a person' && error.captchaType === 'hcaptcha');
});

test('real browser: unlabelled CAPTCHA box beside "Enter the code shown above" text is detected (DNN FormMaster style)', async (t) => {
  const svg = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="130" height="40"><text x="10" y="28" font-size="24">T3PTVZ</text></svg>').toString('base64');
  await withPage(t, `<form id="Form"><h2>Submit a comment</h2><label>Your Name</label><input name="ctl_name"><label>Email</label><input name="ctl_email">
    <label>Enter your questions here:</label><textarea name="ctl_msg"></textarea>
    <div class="Normal"><img src="data:image/svg+xml;base64,${svg}" alt="CAPTCHA image"><div>Enter the code shown above</div><input type="text" maxlength="6" name="dnn$FormMaster$cpt_FormMaster"></div>
    <input type="submit" value="SUBMIT"></form>`, async (page) => {
    const { selectedForm } = await extractForms({ page, timeout: 1000 });
    assert.match(selectedForm.imageCaptcha.inputSelector, /cpt_FormMaster/);
    const result = await solveFormImageCaptcha({ page, captcha: selectedForm.imageCaptcha, solvingEnabled: true, apiKey: 'k', solve: async () => ({ text: 'T3PTVZ' }) });
    assert.equal(result.method, 'fastcaptcha');
    assert.equal(await page.$eval('[name="dnn$FormMaster$cpt_FormMaster"]', (element) => element.value), 'T3PTVZ');
  });
});
