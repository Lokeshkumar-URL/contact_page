import assert from 'node:assert/strict';
import { before, after, test } from 'node:test';
import puppeteer from 'puppeteer';
import { inspectCapSolverWidgets, solveWidgetCapSolver, isCapSolverResponseReady } from '../src/services/captcha/capSolverWidget.js';

let browser;
before(async () => { browser = await puppeteer.launch({ headless: true }); });
after(async () => { await browser?.close(); });
async function withPage(html, run) {
  const page = await browser.newPage();
  await page.setRequestInterception(true);
  page.on('request', (request) => request.abort());
  try { await page.setContent(html); await run(page); } finally { await page.close(); }
}
const settings = { apiKey: 'local-test', solvingEnabled: true };
const token = 'local-test-token-'.repeat(4);

test('local browser: reCAPTCHA response fills only the selected form and calls the named callback', async () => {
  await withPage(`<form id="other"><textarea name="g-recaptcha-response">other-value</textarea></form>
    <form id="contact"><div class="g-recaptcha" data-sitekey="test-key" data-callback="site.completed"><textarea name="g-recaptcha-response"></textarea></div></form>
    <script>window.site={called:false,completed(value){this.called=value;}};</script>`, async (page) => {
    const result = await solveWidgetCapSolver({ page, formSelector: '#contact', settings, solve: async () => ({ gRecaptchaResponse: token }) });
    assert.equal(await page.$eval('#contact textarea', (el) => el.value), token);
    assert.equal(await page.$eval('#other textarea', (el) => el.value), 'other-value');
    assert.equal(await page.evaluate(() => window.site.called), token);
    assert.equal(await isCapSolverResponseReady({ page, formSelector: '#contact', receipt: result.receipt }), true);
    await page.$eval('#contact textarea', (el) => { el.value = ''; });
    assert.equal(await isCapSolverResponseReady({ page, formSelector: '#contact', receipt: result.receipt }), false);
  });
});
test('local browser: dynamically rendered anchor supplies site key and associated registered callback', async () => {
  await withPage(`<form id="contact"><div id="widget"><iframe src="https://www.google.com/recaptcha/api2/anchor?k=dynamic-key&amp;sa=send"></iframe><textarea name="g-recaptcha-response"></textarea></div></form>
    <script>window.___grecaptcha_cfg={clients:{0:{host:document.querySelector('#widget'),options:{callback(value){window.received=value;}}}}};</script>`, async (page) => {
    const widgets = await page.evaluate(inspectCapSolverWidgets, '#contact');
    assert.equal(widgets.length, 1); assert.equal(widgets[0].key, 'dynamic-key');
    await solveWidgetCapSolver({ page, formSelector: '#contact', settings, solve: async (task) => { assert.equal(task.pageAction, 'send'); return { gRecaptchaResponse: token }; } });
    assert.equal(await page.evaluate(() => window.received), token);
  });
});
test('local browser: Turnstile response and callback receive the returned token', async () => {
  await withPage(`<form id="contact"><div class="cf-turnstile" data-sitekey="turn-key" data-action="contact" data-cdata="meta" data-callback="done"><input name="cf-turnstile-response"></div></form>
    <script>window.done=(value)=>{window.received=value;};</script>`, async (page) => {
    await solveWidgetCapSolver({ page, formSelector: '#contact', settings, solve: async (task) => { assert.deepEqual(task.metadata, { action: 'contact', cdata: 'meta' }); return { token }; } });
    assert.equal(await page.$eval('input', (el) => el.value), token);
    assert.equal(await page.evaluate(() => window.received), token);
  });
});
