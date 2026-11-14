/**
 * Workflow-facing helpers that connect CAPTCHA detection to the contact-page automation.
 * Detection and monitoring stay in captchaDetector.js / verificationMonitor.js; this file only decides
 * what the workflow does with their results (pause, resume, skip, send to manual review).
 */
import { ManualReviewError } from '../../browser/manualReview.js';
import { detectCaptcha, CAPTCHA_KINDS } from './captchaDetector.js';
import { waitForHumanVerification, CaptchaBlockedError } from './verificationMonitor.js';

/**
 * Cloudflare browser challenges block the whole page. Call after navigation:
 *  - no challenge             -> returns the detection and the workflow continues
 *  - challenge, human done it -> pauses, then resumes
 *  - not completed in time, or no human available (headless) -> throws CaptchaBlockedError (row is skipped)
 */
export async function guardAgainstBrowserChallenge({ page, timeoutMs = 0, signal, logger, detect = detectCaptcha, wait = waitForHumanVerification } = {}) {
  const detection = await detect(page);
  const challenge = detection?.captchas?.find((item) => item.type === CAPTCHA_KINDS.CLOUDFLARE_CHALLENGE);
  if (!challenge) return detection;
  const outcome = await wait({ page, detection: { ...detection, captchas: [challenge], requiresVerification: true, type: challenge.type }, timeoutMs, signal, logger });
  if (outcome.status === 'verified') return { ...detection, resolved: true };
  const reason = outcome.status === 'human_required'
    ? 'Cloudflare browser challenge detected; it needs a person. Run in Visible browser mode to complete it.'
    : outcome.status === 'aborted' ? 'Cloudflare browser challenge: run was stopped before verification.'
      : `Cloudflare browser challenge was not completed within ${Math.round(timeoutMs / 1000)}s.`;
  throw new CaptchaBlockedError(reason, { detection: { ...detection, type: challenge.type }, status: outcome.status });
}

/**
 * Pause for a person to complete a visible CAPTCHA widget (reCAPTCHA v2 / hCaptcha / Turnstile) and resume
 * once the widget reports completion. Same contract as the previous waitForWidgetCaptcha: resolves with
 * { method } or throws a MANUAL_REVIEW error.
 */
export async function waitForWidgetCaptcha({ page, timeoutMs = 0, signal, logger, detection, wait = waitForHumanVerification } = {}) {
  if (!page) throw new TypeError('A Puppeteer page is required.');
  const outcome = await wait({ page, detection, timeoutMs, signal, logger });
  if (outcome.status === 'verified') return { method: outcome.method === 'human' ? 'verified' : 'widget-auto', elapsedMs: outcome.elapsedMs };
  const message = outcome.status === 'timeout' ? 'The CAPTCHA was not completed in the browser window in time.'
    : outcome.status === 'aborted' ? 'The run was stopped before the CAPTCHA was completed.'
      : outcome.status === 'error' ? `CAPTCHA verification could not be monitored (${outcome.error}); complete it by hand.`
        : 'This CAPTCHA must be solved by a person. Run in Visible browser mode to solve it by hand.';
  const error = new ManualReviewError([{ code: 'CAPTCHA', message, selector: '' }]); error.captchaStatus = outcome.status; throw error;
}
