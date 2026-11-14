import assert from 'node:assert/strict';
import http from 'node:http';
import { after, before, test } from 'node:test';
import puppeteer from 'puppeteer';
import { ensureFieldsStillFilled } from '../src/services/browser/formFiller.js';
import { countSuccessPhrases, verifySubmission } from '../src/services/browser/submissionVerifier.js';

let browser; let browserError; let server; let baseUrl;
const pages = {
  '/form': `<!doctype html><footer>Thank you for visiting our site</footer><form id="f" action="/thanks" method="get"><input name="name"><button>Send</button></form>`,
  '/thanks': `<!doctype html><h1>Thanks for reaching out! We will get back to you shortly.</h1>`,
  '/slow': `<!doctype html><footer>Thank you for visiting</footer><form id="f" onsubmit="event.preventDefault();setTimeout(()=>{document.body.insertAdjacentHTML('beforeend','<p>Your message has been sent.</p>')},2500)"><input name="name"><button>Send</button></form>`,
  '/nothing': `<!doctype html><footer>Thank you for visiting</footer><form id="f" onsubmit="event.preventDefault()"><input name="name"><button>Send</button></form>`,
};
before(async () => {
  try { browser = await puppeteer.launch({ headless: true }); } catch (error) { browserError = error; }
  server = http.createServer((req, res) => { res.setHeader('Content-Type', 'text/html'); res.end(pages[req.url.split('?')[0]] ?? '<p>404</p>'); });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve)); baseUrl = `http://127.0.0.1:${server.address().port}`;
});
after(async () => { await browser?.close(); server?.close(); });
async function open(t, path) { if (!browser) { t.skip(`Chrome unavailable: ${browserError?.message}`); return null; } const page = await browser.newPage(); await page.goto(baseUrl + path); return page; }

test('pre-submit guard refills a field that the site wipes after a delay', async (t) => {
  if (!browser) { t.skip(`Chrome unavailable: ${browserError?.message}`); return; }
  const page = await browser.newPage();
  try {
    await page.setContent('<form><input id="n" required></form><script>setTimeout(()=>{document.getElementById("n").value=""},400)</script>');
    await page.type('#n', 'Patrick');
    const mapping = { selector: '#n', value: 'Patrick', field: { selector: '#n', tag: 'input', type: 'text', required: true, label: 'First name' } };
    const result = await ensureFieldsStillFilled({ page, mappings: [mapping], timeout: 2000, settleMs: 600 });
    assert.deepEqual(result.refilled, ['#n']);
    assert.equal(await page.$eval('#n', (element) => element.value), 'Patrick');
  } finally { await page.close(); }
});

test('pre-submit guard stops when a required field keeps getting wiped', async (t) => {
  if (!browser) { t.skip(`Chrome unavailable: ${browserError?.message}`); return; }
  const page = await browser.newPage();
  try {
    await page.setContent('<form><input id="n" required></form><script>setInterval(()=>{document.getElementById("n").value=""},50)</script>');
    const mapping = { selector: '#n', value: 'Patrick', field: { selector: '#n', tag: 'input', type: 'text', required: true, label: 'First name' } };
    await assert.rejects(() => ensureFieldsStillFilled({ page, mappings: [mapping], timeout: 1000, settleMs: 200 }), (error) => error.code === 'FORM_FILL_FAILED' && /First name/.test(error.message));
  } finally { await page.close(); }
});

test('a "thank you" already on the page before submit is not counted as success', async (t) => {
  const page = await open(t, '/nothing'); if (!page) return;
  try {
    const baselineSuccessCount = await countSuccessPhrases(page); assert.equal(baselineSuccessCount, 1);
    await page.click('button');
    await assert.rejects(() => verifySubmission(page, { formSelector: '#f', initialUrl: page.url(), timeout: 1500, baselineSuccessCount }));
  } finally { await page.close(); }
});

test('a confirmation that appears seconds later is still detected', async (t) => {
  const page = await open(t, '/slow'); if (!page) return;
  try {
    const baselineSuccessCount = await countSuccessPhrases(page); await page.click('button');
    const result = await verifySubmission(page, { formSelector: '#f', initialUrl: page.url(), timeout: 10000, baselineSuccessCount });
    assert.equal(result.outcome, 'success'); assert.match(result.evidence, /message has been sent/i);
  } finally { await page.close(); }
});

test('a redirect to a thank-you page is followed and confirmed', async (t) => {
  const page = await open(t, '/form'); if (!page) return;
  try {
    const initialUrl = page.url(); const baselineSuccessCount = await countSuccessPhrases(page);
    await page.click('button');
    const result = await verifySubmission(page, { formSelector: '#f', initialUrl, timeout: 10000, baselineSuccessCount });
    assert.equal(result.outcome, 'success');
  } finally { await page.close(); }
});
