/**
 * CAPTCHA detection (read-only).
 *
 * Inspects the DOM and frame URLs for reCAPTCHA v2/v3, hCaptcha, Cloudflare Turnstile and Cloudflare
 * browser challenges. It never reads, copies, generates or injects verification tokens, never clicks
 * anything and never interacts with a widget. It only reports what is present.
 */

export const PROVIDERS = Object.freeze({
  RECAPTCHA: 'recaptcha',
  HCAPTCHA: 'hcaptcha',
  TURNSTILE: 'turnstile',
  CLOUDFLARE_CHALLENGE: 'cloudflare_challenge',
});

export const CAPTCHA_KINDS = Object.freeze({
  RECAPTCHA_V2: 'recaptcha_v2',
  RECAPTCHA_V2_INVISIBLE: 'recaptcha_v2_invisible',
  RECAPTCHA_V3: 'recaptcha_v3',
  HCAPTCHA: 'hcaptcha',
  HCAPTCHA_INVISIBLE: 'hcaptcha_invisible',
  TURNSTILE: 'turnstile',
  CLOUDFLARE_CHALLENGE: 'cloudflare_challenge',
});

// Most restrictive first; used to choose the "primary" finding.
const PRIORITY = [CAPTCHA_KINDS.CLOUDFLARE_CHALLENGE, CAPTCHA_KINDS.RECAPTCHA_V2, CAPTCHA_KINDS.HCAPTCHA, CAPTCHA_KINDS.TURNSTILE, CAPTCHA_KINDS.RECAPTCHA_V2_INVISIBLE, CAPTCHA_KINDS.HCAPTCHA_INVISIBLE, CAPTCHA_KINDS.RECAPTCHA_V3];

/** Runs inside the page. Must be self-contained and must return plain, token-free data. */
export function inspectPageForCaptcha() {
  const found = new Map();
  const add = (kind, provider, visible, evidence) => {
    const entry = found.get(kind) ?? { kind, provider, visible: false, evidence: [] };
    entry.visible ||= visible; if (!entry.evidence.includes(evidence)) entry.evidence.push(evidence); found.set(kind, entry);
  };
  const isVisible = (element) => {
    if (!element) return false;
    const rect = element.getBoundingClientRect(); const style = getComputedStyle(element);
    return rect.width > 1 && rect.height > 1 && style.visibility !== 'hidden' && style.display !== 'none' && Number(style.opacity) !== 0;
  };
  const attr = (element, name) => (element.getAttribute(name) || '').toLowerCase();
  const scripts = [...document.querySelectorAll('script[src]')].map((script) => script.getAttribute('src') || '');
  const frames = [...document.querySelectorAll('iframe')].map((frame) => ({ element: frame, src: frame.getAttribute('src') || frame.getAttribute('data-src') || '' }));

  // ---- Cloudflare browser challenge (a full-page interstitial). Not the benign /cdn-cgi/.../jsd/main.js beacon. ----
  const title = (document.title || '').trim();
  const challengeMarkers = [];
  if (/^(just a moment|attention required|checking your browser|verifying you are human|one moment, please)/i.test(title)) challengeMarkers.push(`title:${title.slice(0, 40)}`);
  if (typeof window._cf_chl_opt !== 'undefined') challengeMarkers.push('window._cf_chl_opt');
  for (const selector of ['#challenge-running', '#challenge-stage', '#challenge-form', '#cf-challenge-running', '#cf-please-wait', '.cf-browser-verification', '#challenge-error-text']) if (document.querySelector(selector)) challengeMarkers.push(selector);
  if (scripts.some((src) => /\/cdn-cgi\/challenge-platform\/h\/[a-z]\/orchestrate\//i.test(src))) challengeMarkers.push('orchestrate-script');
  if (challengeMarkers.length) add('cloudflare_challenge', 'cloudflare_challenge', true, challengeMarkers.join(','));

  // ---- Turnstile ----
  const turnstileHosts = [...document.querySelectorAll('.cf-turnstile,[data-sitekey][data-appearance],[data-cf-turnstile]')].filter((element) => element.classList.contains('cf-turnstile') || element.hasAttribute('data-cf-turnstile'));
  for (const host of turnstileHosts) add('turnstile', 'turnstile', isVisible(host) || Boolean(host.querySelector('iframe') && isVisible(host.querySelector('iframe'))), 'div.cf-turnstile');
  for (const { element, src } of frames) if (/challenges\.cloudflare\.com\/cdn-cgi\/challenge-platform\/.*turnstile|challenges\.cloudflare\.com\/turnstile/i.test(src)) add('turnstile', 'turnstile', isVisible(element), 'iframe:turnstile');
  if (document.querySelector('[name="cf-turnstile-response"]')) add('turnstile', 'turnstile', false, 'field:cf-turnstile-response');
  if (scripts.some((src) => /challenges\.cloudflare\.com\/turnstile\//i.test(src)) && !found.has('turnstile')) add('turnstile', 'turnstile', false, 'script:turnstile-api');

  // ---- hCaptcha ----
  for (const host of document.querySelectorAll('.h-captcha')) {
    const invisible = attr(host, 'data-size') === 'invisible';
    add(invisible ? 'hcaptcha_invisible' : 'hcaptcha', 'hcaptcha', !invisible && (isVisible(host) || Boolean(host.querySelector('iframe') && isVisible(host.querySelector('iframe')))), 'div.h-captcha');
  }
  for (const { element, src } of frames) if (/hcaptcha\.com/i.test(src)) {
    if (/challenge/i.test(src) || /frame=challenge/i.test(src)) continue; // popup challenge frame, only shown after the checkbox is used
    const invisible = /size=invisible/i.test(src); add(invisible ? 'hcaptcha_invisible' : 'hcaptcha', 'hcaptcha', !invisible && isVisible(element), 'iframe:hcaptcha');
  }
  if (document.querySelector('[name="h-captcha-response"]') && !found.has('hcaptcha') && !found.has('hcaptcha_invisible')) add('hcaptcha_invisible', 'hcaptcha', false, 'field:h-captcha-response');
  if (scripts.some((src) => /(?:js\.)?hcaptcha\.com\/1\/api\.js/i.test(src)) && !found.has('hcaptcha') && !found.has('hcaptcha_invisible')) add('hcaptcha_invisible', 'hcaptcha', false, 'script:hcaptcha-api');

  // ---- reCAPTCHA v2 (checkbox / invisible) ----
  for (const host of document.querySelectorAll('.g-recaptcha')) {
    const invisible = attr(host, 'data-size') === 'invisible';
    add(invisible ? 'recaptcha_v2_invisible' : 'recaptcha_v2', 'recaptcha', !invisible && (isVisible(host) || Boolean(host.querySelector('iframe') && isVisible(host.querySelector('iframe')))), 'div.g-recaptcha');
  }
  for (const { element, src } of frames) if (/google\.com\/recaptcha\/(?:enterprise\/|api2\/)anchor|recaptcha\.net\/recaptcha\/(?:enterprise\/|api2\/)anchor/i.test(src)) {
    const invisible = /[?&]size=invisible/i.test(src); const v3 = /[?&]size=invisible/i.test(src) && !document.querySelector('.g-recaptcha');
    if (v3 && /[?&]k=/.test(src) && scripts.some((s) => /recaptcha\/(?:enterprise|api)\.js\?[^#]*render=(?!explicit)[\w-]{20,}/i.test(s))) continue; // counted as v3 below
    add(invisible ? 'recaptcha_v2_invisible' : 'recaptcha_v2', 'recaptcha', !invisible && isVisible(element), 'iframe:recaptcha-anchor');
  }
  if (document.querySelector('[name="g-recaptcha-response"]') && !found.has('recaptcha_v2') && !found.has('recaptcha_v2_invisible')) {
    const hostless = !scripts.some((s) => /recaptcha\/(?:enterprise|api)\.js\?[^#]*render=(?!explicit)[\w-]{20,}/i.test(s));
    if (hostless) add('recaptcha_v2_invisible', 'recaptcha', false, 'field:g-recaptcha-response');
  }

  // ---- reCAPTCHA v3: api.js?render=<site key> (not "explicit"), badge only, no visible checkbox ----
  const v3Script = scripts.find((src) => /recaptcha\/(?:enterprise|api)\.js\?[^#]*render=(?!explicit)[\w-]{20,}/i.test(src));
  if (v3Script && !found.has('recaptcha_v2')) add('recaptcha_v3', 'recaptcha', false, `script:${/enterprise/i.test(v3Script) ? 'recaptcha-enterprise' : 'recaptcha'}-render`);
  else if (document.querySelector('.grecaptcha-badge') && !found.has('recaptcha_v2') && !found.has('recaptcha_v2_invisible')) add('recaptcha_v3', 'recaptcha', false, 'badge:grecaptcha-badge');
  if (found.has('recaptcha_v3') && found.has('recaptcha_v2_invisible') && v3Script) found.delete('recaptcha_v2_invisible');

  // Challenge pages embed a Turnstile widget; report only the page-level challenge.
  if (found.has('cloudflare_challenge')) found.delete('turnstile');
  return [...found.values()];
}

const LABELS = Object.freeze({
  recaptcha_v2: 'reCAPTCHA v2 (checkbox)', recaptcha_v2_invisible: 'reCAPTCHA v2 (invisible)', recaptcha_v3: 'reCAPTCHA v3',
  hcaptcha: 'hCaptcha', hcaptcha_invisible: 'hCaptcha (invisible)', turnstile: 'Cloudflare Turnstile', cloudflare_challenge: 'Cloudflare browser challenge',
});
export const captchaLabel = (kind) => LABELS[kind] ?? kind;

const noCaptcha = (extra = {}) => ({ detected: false, provider: null, type: null, label: null, visible: false, requiresVerification: false, passive: false, captchas: [], evidence: [], error: null, ...extra });

/** Turns raw findings into the structured detection result. */
export function buildDetectionResult(findings = []) {
  const captchas = findings
    .filter((finding) => finding?.kind)
    .map((finding) => ({
      provider: finding.provider, type: finding.kind, label: captchaLabel(finding.kind), visible: finding.visible === true,
      // A person must act only for challenges that are on screen. Invisible and v3 integrations are scored by the site itself.
      requiresVerification: finding.kind === CAPTCHA_KINDS.CLOUDFLARE_CHALLENGE || (finding.visible === true && ![CAPTCHA_KINDS.RECAPTCHA_V3, CAPTCHA_KINDS.RECAPTCHA_V2_INVISIBLE, CAPTCHA_KINDS.HCAPTCHA_INVISIBLE].includes(finding.kind)),
      passive: [CAPTCHA_KINDS.RECAPTCHA_V3, CAPTCHA_KINDS.RECAPTCHA_V2_INVISIBLE, CAPTCHA_KINDS.HCAPTCHA_INVISIBLE].includes(finding.kind),
      evidence: finding.evidence ?? [],
    }))
    .sort((a, b) => PRIORITY.indexOf(a.type) - PRIORITY.indexOf(b.type));
  if (!captchas.length) return noCaptcha();
  const primary = captchas.find((item) => item.requiresVerification) ?? captchas[0];
  return { detected: true, provider: primary.provider, type: primary.type, label: primary.label, visible: primary.visible, requiresVerification: captchas.some((item) => item.requiresVerification), passive: captchas.every((item) => item.passive), captchas, evidence: primary.evidence, error: null };
}

/**
 * Detect CAPTCHAs on a Puppeteer page. Never throws: a failure is reported as `error` with detected=false
 * so that a detection problem cannot break the surrounding workflow.
 * Frames (e.g. an embedded contact form) are inspected as well.
 */
export async function detectCaptcha(page, { includeFrames = true } = {}) {
  if (!page || typeof page.evaluate !== 'function') return noCaptcha({ error: 'A Puppeteer page is required for CAPTCHA detection.' });
  try {
    const findings = [...await page.evaluate(inspectPageForCaptcha)];
    if (includeFrames && typeof page.frames === 'function') {
      const main = page.mainFrame?.();
      for (const frame of page.frames()) {
        if (frame === main || frame.isDetached?.()) continue;
        if (/recaptcha|hcaptcha|challenges\.cloudflare/i.test(frame.url?.() ?? '')) continue; // provider frames are detected from the parent
        try { findings.push(...await frame.evaluate(inspectPageForCaptcha)); } catch { /* cross-origin or detached frame */ }
      }
    }
    // Merge duplicates by kind.
    const merged = new Map();
    for (const finding of findings) { const existing = merged.get(finding.kind); if (existing) { existing.visible ||= finding.visible; existing.evidence.push(...finding.evidence); } else merged.set(finding.kind, { ...finding, evidence: [...finding.evidence] }); }
    return buildDetectionResult([...merged.values()]);
  } catch (error) {
    return noCaptcha({ error: `CAPTCHA detection failed: ${error?.message ?? error}` });
  }
}
