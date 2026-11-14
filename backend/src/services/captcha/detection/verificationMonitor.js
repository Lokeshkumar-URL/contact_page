/**
 * Waits for a person to complete a CAPTCHA / browser challenge, then lets the workflow resume.
 *
 * The workflow is "paused" simply by awaiting this function; it "resumes" when it resolves with
 * status "verified". Completion is observed passively (the site's own widget state); this module
 * never clicks, solves, reads or forwards a verification token, and never injects one. Response
 * fields are only tested for "is non-empty" inside the page; their values are never returned.
 */
import { detectCaptcha, CAPTCHA_KINDS } from './captchaDetector.js';

export class CaptchaBlockedError extends Error {
  constructor(message, { detection, status = 'timeout' } = {}) {
    super(message); this.name = 'CaptchaBlockedError'; this.code = 'CAPTCHA_BLOCKED'; this.stage = 'captcha'; this.retryable = false;
    this.captchaStatus = status; this.captchaType = detection?.type ?? '';
  }
}

/** Runs in the page; returns booleans only. */
export function readCompletionState() {
  const filled = (selector) => [...document.querySelectorAll(selector)].some((field) => String(field.value ?? '').trim().length > 0);
  const hcaptchaFrameDone = [...document.querySelectorAll('iframe[data-hcaptcha-response]')].some((frame) => (frame.getAttribute('data-hcaptcha-response') || '').length > 0);
  const title = (document.title || '').trim();
  const challengePresent = /^(just a moment|attention required|checking your browser|verifying you are human|one moment, please)/i.test(title)
    || typeof window._cf_chl_opt !== 'undefined'
    || Boolean(document.querySelector('#challenge-running,#challenge-stage,#challenge-form,#cf-challenge-running,#cf-please-wait,.cf-browser-verification'));
  return { recaptcha: filled('[name="g-recaptcha-response"]'), hcaptcha: filled('[name="h-captcha-response"]') || hcaptchaFrameDone, turnstile: filled('[name="cf-turnstile-response"]'), challengePresent };
}

export async function recaptchaCheckboxTicked(page) {
  try {
    const children = (context) => (context.childFrames?.() ?? []).flatMap((frame) => [frame, ...children(frame)]);
    const frames = typeof page.frames === 'function' ? page.frames() : children(page);
    let found = false;
    for (const frame of frames) {
      if (!/recaptcha\/(?:enterprise\/|api2\/)anchor/i.test(frame.url?.() ?? '')) continue;
      found = true;
      if (!await frame.evaluate(() => document.querySelector('#recaptcha-anchor')?.getAttribute('aria-checked') === 'true').catch(() => false)) return false;
    }
    return found;
  } catch { return false; } // Missing or detached widgets are not verified.
}

/** One non-blocking check: has the CAPTCHA described by `detection` been completed? */
export async function isVerificationComplete(page, detection) {
  const state = await page.evaluate(readCompletionState);
  const types = (detection.captchas ?? []).filter((item) => item.requiresVerification).map((item) => item.type);
  if (!types.length) return true;
  if (types.includes(CAPTCHA_KINDS.CLOUDFLARE_CHALLENGE)) return !state.challengePresent; // page moved on to the real site
  if (types.includes(CAPTCHA_KINDS.RECAPTCHA_V2) && !await recaptchaCheckboxTicked(page)) return false;
  return types.every((type) => {
    if (type === CAPTCHA_KINDS.RECAPTCHA_V2) return state.recaptcha;
    if (type === CAPTCHA_KINDS.HCAPTCHA) return state.hcaptcha;
    if (type === CAPTCHA_KINDS.TURNSTILE) return state.turnstile;
    return true;
  });
}

const sleep = (ms, signal) => new Promise((resolve) => { const timer = setTimeout(resolve, ms); signal?.addEventListener?.('abort', () => { clearTimeout(timer); resolve(); }, { once: true }); });

/**
 * @returns {Promise<{status:'verified'|'not_required'|'human_required'|'timeout'|'aborted'|'error', method:string, elapsedMs:number, detection:object, error?:string}>}
 *  - not_required   nothing on the page needs a person
 *  - human_required timeoutMs is 0 (e.g. headless mode): nobody can complete it, so do not wait
 *  - verified       the person completed it; the caller may resume
 *  - timeout        not completed within timeoutMs
 */
export async function waitForHumanVerification({ page, detection, timeoutMs = 0, pollMs = 500, signal, logger, onPause, onResume } = {}) {
  const started = Date.now(); const elapsed = () => Date.now() - started;
  try {
    const current = detection ?? await detectCaptcha(page);
    if (current.error) return { status: 'error', method: 'none', elapsedMs: elapsed(), detection: current, error: current.error };
    if (!current.requiresVerification) return { status: 'not_required', method: 'none', elapsedMs: elapsed(), detection: current };
    if (await isVerificationComplete(page, current)) return { status: 'verified', method: 'already-complete', elapsedMs: elapsed(), detection: current };
    if (!(timeoutMs > 0)) return { status: 'human_required', method: 'none', elapsedMs: elapsed(), detection: current };

    logger?.info?.('Paused for human CAPTCHA verification', { type: current.type, timeoutMs }); await onPause?.(current);
    await page.bringToFront?.().catch?.(() => {});
    await page.evaluate(() => document.querySelector('.g-recaptcha,.h-captcha,.cf-turnstile,iframe[src*="recaptcha"],iframe[src*="hcaptcha"],iframe[src*="challenges.cloudflare.com"]')?.scrollIntoView({ block: 'center' })).catch(() => {});

    while (elapsed() < timeoutMs) {
      if (signal?.aborted) return { status: 'aborted', method: 'none', elapsedMs: elapsed(), detection: current };
      let done = false;
      try { done = await isVerificationComplete(page, current); }
      catch { done = false; } // a challenge reload destroys the execution context; keep polling
      if (done) { await onResume?.(current); logger?.info?.('CAPTCHA verified by a person; resuming', { type: current.type }); return { status: 'verified', method: 'human', elapsedMs: elapsed(), detection: current }; }
      await sleep(Math.min(pollMs, Math.max(1, timeoutMs - elapsed())), signal);
    }
    if (signal?.aborted) return { status: 'aborted', method: 'none', elapsedMs: elapsed(), detection: current };
    return { status: 'timeout', method: 'none', elapsedMs: elapsed(), detection: current };
  } catch (error) {
    return { status: 'error', method: 'none', elapsedMs: elapsed(), detection: detection ?? null, error: error?.message ?? String(error) };
  }
}
