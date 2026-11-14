import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import puppeteer from 'puppeteer';
import { extractForms } from '../src/services/browser/formExtractor.js';
import { rankContactCandidates } from '../src/services/browser/contactPageFinder.js';
import { lookupWithRetry } from '../src/services/browser/navigationService.js';
import { resolveSelectOption } from '../src/services/browser/formFiller.js';
import { classifySubmissionState } from '../src/services/browser/submissionVerifier.js';
import { waitForWidgetCaptcha } from '../src/services/captcha/imageCaptchaSolver.js';

let browser; let browserError;
before(async () => { try { browser = await puppeteer.launch({ headless: true }); } catch (error) { browserError = error; } });
after(async () => { await browser?.close(); });
async function withPage(t, html, run) {
  if (!browser) { t.skip(`Chrome unavailable: ${browserError?.message}`); return; }
  const page = await browser.newPage();
  try { await page.setContent(html); await run(page); } finally { await page.close(); }
}

test('contact discovery recognises "Get in touch" style links and /contactus paths', () => {
  const ranked = rankContactCandidates([
    { href: '/about', text: 'About', context: 'nav' },
    { href: '/lets-talk', text: 'Get in touch', context: 'nav' },
    { href: '/contactus', text: 'Reach us', context: 'footer' },
    { href: '/blog/contact-tips', text: 'Contact tips blog', context: 'body' },
  ], 'https://example.com/');
  assert.ok(ranked.find((c) => c.url.endsWith('/lets-talk')).score >= 55);
  assert.ok(ranked.find((c) => c.url.endsWith('/contactus')).score >= 55);
  assert.ok(ranked.find((c) => c.url.includes('/blog/')).score < 55);
});

test('DNS lookups retry transient failures before giving up', async () => {
  let calls = 0;
  const addresses = await lookupWithRetry('example.com', { delayMs: 1, resolve: async () => { calls += 1; if (calls < 3) throw Object.assign(new Error('EAI_AGAIN'), { code: 'EAI_AGAIN' }); return [{ address: '93.184.216.34' }]; } });
  assert.equal(calls, 3); assert.equal(addresses[0].address, '93.184.216.34');
  await assert.rejects(() => lookupWithRetry('nope.invalid', { attempts: 2, delayMs: 1, resolve: async () => { throw new Error('ENOTFOUND'); } }), /ENOTFOUND/);
});

test('subject and purpose dropdowns fall back to a general option', () => {
  const options = [{ value: '', text: 'Select a subject' }, { value: 'support', text: 'Technical support' }, { value: 'general', text: 'General Question' }];
  assert.equal(resolveSelectOption({ profileKey: 'subject', value: 'Business Inquiry', field: { options } }).value, 'general');
  assert.equal(resolveSelectOption({ profileKey: 'email', value: 'x', field: { options } }), null);
});

test('more confirmation phrasings count as success', () => {
  for (const text of ['Thanks for reaching out!', 'Your message has been sent.', 'Our team will get back to you shortly', 'Form submitted successfully']) {
    assert.equal(classifySubmissionState({ bodyText: text }).outcome, 'success', text);
  }
});

test('real browser: contact form built from <div>s (no <form> tag) is detected', async (t) => {
  await withPage(t, `<main><h2>Contact us</h2><div class="contact-card">
    <label for="n">Your name</label><input id="n">
    <label for="e">Email</label><input id="e" type="email">
    <label for="m">Message</label><textarea id="m"></textarea>
    <button type="button" class="cta">Send message</button></div></main>`, async (page) => {
    const extracted = await extractForms({ page, timeout: 1000 });
    assert.equal(extracted.selectedForm.formless, true);
    assert.deepEqual(extracted.selectedForm.fields.map((f) => f.selector), ['#n', '#e', '#m']);
    assert.equal(extracted.selectedForm.submitButtons[0].text, 'Send message');
  });
});

test('real browser: invisible reCAPTCHA does not block, checkbox reCAPTCHA does', async (t) => {
  const form = (extra) => `<form id="contact"><h2>Contact</h2><input name="name" placeholder="Name"><input type="email" name="email"><textarea name="message"></textarea>${extra}<button>Send</button></form>`;
  await withPage(t, form('<div class="grecaptcha-badge" style="width:256px;height:60px"><iframe src="https://www.google.com/recaptcha/api2/anchor?size=invisible" style="width:256px;height:60px"></iframe></div>'), async (page) => {
    const extracted = await extractForms({ page, timeout: 1000 });
    assert.equal(extracted.hasCaptcha, false);
  });
  await withPage(t, form('<div class="g-recaptcha" data-sitekey="abc" style="width:304px;height:78px"></div>'), async (page) => {
    const extracted = await extractForms({ page, timeout: 1000 });
    assert.equal(extracted.hasCaptcha, true); assert.equal(extracted.captchaKind, 'recaptcha');
  });
});

test('real browser: widget CAPTCHA waits for the person, then continues', async (t) => {
  await withPage(t, '<form><div class="g-recaptcha" style="width:304px;height:78px"></div><textarea name="g-recaptcha-response"></textarea></form>', async (page) => {
    await assert.rejects(() => waitForWidgetCaptcha({ page, timeoutMs: 0 }), (error) => error.code === 'MANUAL_REVIEW');
    setTimeout(() => page.evaluate(() => { document.querySelector('[name="g-recaptcha-response"]').value = 'x'.repeat(40); }).catch(() => {}), 300);
    assert.equal((await waitForWidgetCaptcha({ page, timeoutMs: 5000 })).method, 'manual');
  });
});

test('real browser: ASP.NET-style "Submit" link is used as the submit control, Cancel/Login are not', async (t) => {
  await withPage(t, `<form id="Form"><a href="/Login">Login</a><a onclick="go()" href="#">Contact Us</a>
    <input name="dnn$Name" placeholder="Name"><input name="dnn$Email" placeholder="Email"><textarea name="dnn$Message" placeholder="Message"></textarea>
    <img alt="CAPTCHA image" src="/never-loads.captcha.aspx?captcha=1"><div>Enter the code shown above in the box below.</div><input type="text" maxlength="6" name="dnn$Form$Captcha">
    <a id="cmdUpdate" href="javascript:__doPostBack('cmdUpdate','')">Submit</a> <a href="javascript:__doPostBack('cmdCancel','')">Cancel</a></form>`, async (page) => {
    const { selectedForm } = await extractForms({ page, timeout: 1000 });
    assert.deepEqual(selectedForm.submitButtons.map((button) => button.text), ['Submit']);
    assert.equal(selectedForm.imageCaptcha?.inputSelector.includes('Captcha'), true, 'still-loading CAPTCHA image is detected');
  });
});
