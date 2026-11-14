import { ManualReviewError } from '../browser/manualReview.js';
import { solveImageCaptchaFastCaptcha } from './fastCaptchaClient.js';
import { solveImageCapSolver } from './capSolverClient.js';
import { solveImageCaptchaOhMyCaptcha } from './ohMyCaptchaClient.js';
import { solveMathQuestion } from './captchaClassifier.js';

// A real text CAPTCHA image is small; a logo or banner picked up by mistake is
// usually a different shape. Reject anything outside a plausible size.
export function plausibleCaptchaSize(box) {
  return Boolean(box) && box.width >= 40 && box.width <= 400 && box.height >= 15 && box.height <= 150;
}

/** 1. Capture the CAPTCHA image element as base64 PNG (no full-page fallback). */
export async function captureCaptchaImage(page, imageSelector) {
  // CAPTCHA images are often generated server-side and arrive after the rest of the page; wait for them.
  if (typeof page.waitForFunction === 'function') await page.waitForFunction((selector) => { const element = document.querySelector(selector); return !element || element.tagName !== 'IMG' || (element.complete && element.naturalWidth > 0); }, { timeout: 8000, polling: 200 }, imageSelector).catch(() => {});
  const handle = await page.$(imageSelector).catch(() => null);
  if (!handle) return null;
  try {
    const box = await handle.boundingBox().catch(() => null);
    if (!plausibleCaptchaSize(box)) return null;
    const image = await handle.screenshot({ encoding: 'base64', type: 'png' });
    return image || null;
  } finally { await handle.dispose?.().catch(() => {}); }
}

async function readValue(page, selector) {
  return page.evaluate((sel) => document.querySelector(sel)?.value ?? null, selector).catch(() => null);
}

/** 4. Type the solved text into the CAPTCHA field and confirm it was kept. */
export async function enterCaptchaText(page, inputSelector, text) {
  await page.click(inputSelector, { clickCount: 3 });
  if (page.keyboard?.press) await page.keyboard.press('Backspace');
  else await page.evaluate((sel) => { const el = document.querySelector(sel); if (el) { el.value = ''; el.dispatchEvent(new Event('input', { bubbles: true })); } }, inputSelector);
  await page.type(inputSelector, text, { delay: 20 });
  await page.evaluate((sel) => { const el = document.querySelector(sel); if (el) { el.dispatchEvent(new Event('change', { bubbles: true })); el.blur(); } }, inputSelector);
  return (await readValue(page, inputSelector)) === text;
}

/** 5. Fallback: in a visible browser, wait for a person to type the CAPTCHA themselves. */
async function waitForManualEntry(page, inputSelector, timeoutMs, minLength = 3) {
  await page.evaluate((sel) => { const el = document.querySelector(sel); if (el) { el.value = ''; el.scrollIntoView({ block: 'center' }); el.focus(); el.style.outline = '3px solid #f59e0b'; } }, inputSelector).catch(() => {});
  try {
    await page.waitForFunction((sel, min) => (document.querySelector(sel)?.value ?? '').trim().length >= min, { timeout: timeoutMs, polling: 500 }, inputSelector, minLength);
    return true;
  } catch { return false; }
  finally { await page.evaluate((sel) => { const el = document.querySelector(sel); if (el) el.style.outline = ''; }, inputSelector).catch(() => {}); }
}

const WIDGET_TOKEN_SELECTOR = '[name="g-recaptcha-response"],[name="h-captcha-response"],[name="cf-turnstile-response"]';

/**
 * Checkbox CAPTCHAs (reCAPTCHA v2, hCaptcha, Turnstile) cannot be read by FastCaptcha. In a visible
 * browser, wait for the person at the screen to complete the widget; the site's own token field fills in.
 */
export async function waitForWidgetCaptcha({ page, timeoutMs = 0, logger } = {}) {
  if (!page) throw new TypeError('A Puppeteer page is required.');
  const solved = () => page.evaluate((selector) => [...document.querySelectorAll(selector)].some((field) => String(field.value ?? '').trim().length > 20), WIDGET_TOKEN_SELECTOR).catch(() => false);
  if (await solved()) return { method: 'widget-auto' };
  if (timeoutMs > 0) {
    logger?.info?.('Waiting for a person to complete the CAPTCHA in the browser window', { timeoutMs });
    await page.evaluate(() => document.querySelector('.g-recaptcha,.h-captcha,.cf-turnstile,iframe[src*="recaptcha"],iframe[src*="hcaptcha"],iframe[src*="challenges.cloudflare.com"]')?.scrollIntoView({ block: 'center' })).catch(() => {});
    try {
      await page.waitForFunction((selector) => [...document.querySelectorAll(selector)].some((field) => String(field.value ?? '').trim().length > 20), { timeout: timeoutMs, polling: 500 }, WIDGET_TOKEN_SELECTOR);
      return { method: 'manual' };
    } catch { /* fall through to manual review */ }
  }
  throw new ManualReviewError([{ code: 'CAPTCHA', message: timeoutMs > 0 ? 'The CAPTCHA was not completed in the browser window in time.' : 'This CAPTCHA must be solved by a person. Run in Visible browser mode to solve it by hand.', selector: '' }]);
}

/**
 * Capture -> FastCaptcha -> type answer. On any failure falls back to manual
 * entry in a visible browser, and finally to the existing MANUAL_REVIEW outcome.
 */
export async function solveFormImageCaptcha({ page, captcha, apiKey, timeoutMs = 20000, attempts = 2, manualEntryTimeoutMs = 0, solve = solveImageCaptchaFastCaptcha, mathEnabled = true, solvingEnabled = false, ohMyCaptcha, capSolver, signal, logger } = {}) {
  if (!page) throw new TypeError('A Puppeteer page is required.');
  // Third-party/automatic solving is opt-in (CAPTCHA_SOLVING_ENABLED). Off by default: the API key is never used.
  if (!solvingEnabled) { apiKey = undefined; mathEnabled = false; }
  const { inputSelector, imageSelector } = captcha ?? {};
  if (!inputSelector) throw new TypeError('A CAPTCHA input selector is required.');
  const failures = [];
  const provider = solvingEnabled && capSolver ? 'capsolver' : solvingEnabled && ohMyCaptcha?.baseUrl ? 'ohmycaptcha' : 'fastcaptcha';
  if (provider === 'capsolver') { apiKey = 'configured'; timeoutMs = capSolver.timeoutMs; solve = (image) => solveImageCapSolver(image, { ...capSolver, solvingEnabled, signal }); }
  if (provider === 'ohmycaptcha') { apiKey = 'configured'; timeoutMs = ohMyCaptcha.timeoutMs; solve = (image) => solveImageCaptchaOhMyCaptcha(image, { ...ohMyCaptcha, solvingEnabled, signal }); }

  if (apiKey && imageSelector) {
    for (let attempt = 1; attempt <= attempts; attempt += 1) {
      try {
        const image = await captureCaptchaImage(page, imageSelector);
        if (!image) { failures.push('captcha-image-not-captured'); break; }
        const { text: read } = await solve(image, { apiKey, timeoutMs, solvingEnabled });
        // A math image ("3 + 4 =") is read by FastCaptcha, then calculated here when math answers are allowed.
        const mathAnswer = captcha.math ? (mathEnabled ? solveMathQuestion(read) : null) : null;
        if (captcha.math && mathAnswer === null) { failures.push(mathEnabled ? `math-image-unreadable ("${read}")` : 'math answers disabled'); continue; }
        const text = mathAnswer ?? read;
        if (await enterCaptchaText(page, inputSelector, text)) {
          logger?.info?.('CAPTCHA answer entered', { provider, attempt });
          return { method: provider, attempts: attempt };
        }
        failures.push('captcha-value-rejected');
      } catch (error) {
        if (signal?.aborted) throw error;
        failures.push(error.code === 'FASTCAPTCHA_FAILED' ? error.message : `captcha-entry-failed: ${error.message}`);
        logger?.warn?.('CAPTCHA solve attempt failed', { provider, attempt, error: error.message });
      }
    }
  } else failures.push(apiKey ? 'captcha-image-not-found' : 'FASTCAPTCHA_API_KEY not configured');

  if (manualEntryTimeoutMs > 0) {
    logger?.info?.('Waiting for manual CAPTCHA entry in the browser window', { timeoutMs: manualEntryTimeoutMs });
    if (await waitForManualEntry(page, inputSelector, manualEntryTimeoutMs)) return { method: 'manual', attempts: 0 };
    failures.push('manual-entry-timed-out');
  }

  throw new ManualReviewError([{ code: 'CAPTCHA', message: `Image CAPTCHA could not be solved automatically (${failures.join('; ')}); enter it manually.`, selector: inputSelector }]);
}

/** Math CAPTCHA given as text ("What is 3 + 4?"): calculate the answer and type it in. */
export async function solveMathCaptcha({ page, captcha, autoAnswer = true, manualEntryTimeoutMs = 0, solvingEnabled = false, ohMyCaptcha, capSolver, signal, logger } = {}) {
  if (!page) throw new TypeError('A Puppeteer page is required.');
  if (!solvingEnabled) autoAnswer = false; // automatic answering is opt-in (CAPTCHA_SOLVING_ENABLED)
  const answer = autoAnswer ? solveMathQuestion(captcha?.question) : null;
  if (answer !== null && await enterCaptchaText(page, captcha.inputSelector, answer).catch(() => false)) {
    logger?.info?.('Math CAPTCHA answered', { question: captcha.question });
    return { method: 'math', answer };
  }
  if (manualEntryTimeoutMs > 0 && await waitForManualEntry(page, captcha.inputSelector, manualEntryTimeoutMs, 1)) return { method: 'manual' };
  throw new ManualReviewError([{ code: 'CAPTCHA', message: `Math CAPTCHA could not be answered automatically ("${String(captcha?.question ?? '').slice(0, 60)}"); enter it manually.`, selector: captcha?.inputSelector ?? '' }]);
}
