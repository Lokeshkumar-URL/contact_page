import { recaptchaCheckboxTicked } from './detection/verificationMonitor.js';
import { solveOhMyCaptcha } from './ohMyCaptchaClient.js';

// Only explicit form widgets are handled. Full-page Cloudflare challenges and passive v3 stay site-managed.
export async function solveWidgetOhMyCaptcha({ page, formSelector, settings, signal, solve = solveOhMyCaptcha } = {}) {
  const contexts = typeof page.frames === 'function' ? page.frames() : [page];
  let count = 0;
  for (const context of contexts) {
    const widgets = await context.evaluate((selector) => {
      const root = selector ? document.querySelector(selector) : document;
      if (!root) return [];
      return [...root.querySelectorAll('.g-recaptcha[data-sitekey],.h-captcha[data-sitekey],.cf-turnstile[data-sitekey]')].map((host) => ({
        key: host.getAttribute('data-sitekey'), provider: host.matches('.h-captcha') ? 'hcaptcha' : host.matches('.cf-turnstile') ? 'turnstile' : 'recaptcha',
        invisible: host.getAttribute('data-size') === 'invisible', enterprise: [...document.scripts].some((script) => /recaptcha\/enterprise\.js/.test(script.src)),
      }));
    }, context === page || context === page.mainFrame?.() ? formSelector : undefined).catch(() => []);
    for (const widget of widgets) {
      const type = widget.provider === 'hcaptcha' ? 'HCaptchaTaskProxyless' : widget.provider === 'turnstile' ? 'TurnstileTaskProxyless' : widget.enterprise ? 'RecaptchaV2EnterpriseTaskProxyless' : 'RecaptchaV2TaskProxyless';
      const solution = await solve({ type, websiteURL: context.url(), websiteKey: widget.key, isInvisible: widget.invisible }, { ...settings, signal });
      const token = solution.token || solution.gRecaptchaResponse;
      if (typeof token !== 'string' || !token.trim()) throw new Error('Solver returned no widget token.');
      const applied = await context.evaluate(async ({ widget, token }) => {
        const host = [...document.querySelectorAll('[data-sitekey]')].find((node) => node.getAttribute('data-sitekey') === widget.key);
        if (!host) return false;
        const names = widget.provider === 'hcaptcha' ? ['h-captcha-response', 'g-recaptcha-response'] : [widget.provider === 'turnstile' ? 'cf-turnstile-response' : 'g-recaptcha-response'];
        const root = host.closest('form') || host;
        let fields = 0;
        for (const name of names) for (const field of root.querySelectorAll(`[name="${name}"]`)) {
          field.value = token; field.dispatchEvent(new Event('input', { bubbles: true })); field.dispatchEvent(new Event('change', { bubbles: true })); fields++;
        }
        const callbackName = host.getAttribute('data-callback');
        let callback = window;
        if (callbackName) for (const part of callbackName.split('.')) callback = callback?.[part];
        if (callbackName && typeof callback === 'function') { await callback(token); return true; }
        return fields > 0;
      }, { widget, token });
      if (!applied) throw new Error('Widget has no supported response field or callback. Complete it manually.');
      if (widget.provider === 'recaptcha' && !widget.invisible && !await recaptchaCheckboxTicked(page)) {
        // A token from another browser does not establish verification in this browser.
        await context.evaluate(({ token }) => {
          for (const field of document.querySelectorAll('[name="g-recaptcha-response"]')) {
            if (field.value === token) { field.value = ''; field.dispatchEvent(new Event('input', { bubbles: true })); field.dispatchEvent(new Event('change', { bubbles: true })); }
          }
        }, { token }).catch(() => {});
        throw new Error('The current browser reCAPTCHA checkbox is still unverified. Complete the challenge in this browser.');
      }
      count++;
    }
  }
  if (!count) throw new Error('No supported explicit CAPTCHA widget found. Complete it manually.');
  return { method: 'ohmycaptcha', widgets: count };
}
