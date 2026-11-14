/**
 * CAPTCHA policy, one place:
 *  - text  : image of letters/numbers -> solved with FastCaptcha (the permitted integration), else manual entry / review
 *  - math  : "What is 3 + 4?" (text or image) -> answered automatically only when MATH_CAPTCHA_ENABLED (authorised)
 *  - recaptcha_v2 / hcaptcha / turnstile : detect and report only (a person completes them in Visible mode)
 *  - recaptcha_v3 : detect and report as site-managed; never send its token or site key to a solver
 */
export const CAPTCHA_TYPES = Object.freeze({
  text: { label: 'Text CAPTCHA', needsPerson: false },
  math: { label: 'Math CAPTCHA', needsPerson: false },
  recaptcha_v2: { label: 'reCAPTCHA v2 (checkbox)', needsPerson: true },
  recaptcha_v3: { label: 'reCAPTCHA v3 (invisible)', needsPerson: false, passive: true },
  hcaptcha: { label: 'hCaptcha', needsPerson: true },
  turnstile: { label: 'Cloudflare Turnstile', needsPerson: true },
  cloudflare_challenge: { label: 'Cloudflare browser challenge', needsPerson: true },
});

const WIDGET_TYPE = { recaptcha: 'recaptcha_v2', hcaptcha: 'hcaptcha', turnstile: 'turnstile' };

/** Every CAPTCHA on the selected form, most restrictive first. */
export function classifyCaptchas({ form = {}, pageHasCaptcha = false, captchaKind = null, passiveCaptchaKinds = [] } = {}) {
  const found = [];
  if (pageHasCaptcha || form.hasCaptcha) found.push(WIDGET_TYPE[form.captchaKind ?? captchaKind] ?? 'recaptcha_v2');
  for (const kind of passiveCaptchaKinds) if (CAPTCHA_TYPES[kind]?.passive && !found.includes(kind)) found.push(kind);
  if (form.mathCaptcha || form.imageCaptcha?.math) found.push('math');
  else if (form.imageCaptcha) found.push('text');
  return found;
}

const OUTCOME_TEXT = { capsolver: 'response prepared by CapSolver (acceptance unverified)', capsolver_accepted: 'accepted by website (CapSolver)', ohmycaptcha: 'solved by OhMyCaptcha', fastcaptcha: 'solved by FastCaptcha', math: 'solved automatically', manual: 'completed by a person', verified: 'verified by a person', timeout: 'not verified in time', blocked: 'blocked – skipped', detected_passive: 'detected (site-managed, no action needed)', 'widget-auto': 'passed automatically', needs_person: 'needs a person', failed: 'not solved', not_reached: 'not reached (stopped earlier)', disabled: 'automatic answer disabled' };

/** "Text CAPTCHA – solved by FastCaptcha", "reCAPTCHA v2 (checkbox) – needs a person", ... */
export function describeCaptcha(types = [], outcomes = {}) {
  return types.map((type) => `${CAPTCHA_TYPES[type]?.label ?? type} – ${OUTCOME_TEXT[outcomes[type] ?? (CAPTCHA_TYPES[type]?.needsPerson ? 'needs_person' : 'failed')] ?? outcomes[type]}`).join('; ');
}

const NUMBER_WORDS = { zero: 0, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10, eleven: 11, twelve: 12, thirteen: 13, fourteen: 14, fifteen: 15, sixteen: 16, seventeen: 17, eighteen: 18, nineteen: 19, twenty: 20 };
const NUMBER = `(\\d{1,3}|${Object.keys(NUMBER_WORDS).join('|')})`;
const OPERATOR = '(\\+|plus|added to|-|−|–|minus|less|x|×|\\*|times|multiplied by|/|÷|divided by)';
const MATH_EXPRESSION = new RegExp(`${NUMBER}\\s*${OPERATOR}\\s*${NUMBER}`, 'i');
const toNumber = (token) => (/^\d+$/.test(token) ? Number(token) : NUMBER_WORDS[token.toLowerCase()]);

/**
 * Parses a simple two-number question ("What is 3 + 4?", "seven minus two", "12 x 3 =") and returns the
 * answer as a string, or null. Arithmetic is computed directly; nothing is ever evaluated as code.
 */
export function solveMathQuestion(text = '') {
  const cleaned = String(text).replace(/\s+/g, ' ').trim();
  const match = MATH_EXPRESSION.exec(cleaned); if (!match) return null;
  const left = toNumber(match[1]); const right = toNumber(match[3]); const operator = match[2].toLowerCase();
  if (!Number.isFinite(left) || !Number.isFinite(right)) return null;
  let answer;
  if (['+', 'plus', 'added to'].includes(operator)) answer = left + right;
  else if (['-', '−', '–', 'minus', 'less'].includes(operator)) answer = left - right;
  else if (['x', '×', '*', 'times', 'multiplied by'].includes(operator)) answer = left * right;
  else if (['/', '÷', 'divided by'].includes(operator)) { if (right === 0 || left % right !== 0) return null; answer = left / right; }
  return Number.isInteger(answer) ? String(answer) : null;
}
