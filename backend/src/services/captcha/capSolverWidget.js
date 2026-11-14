import { CapSolverError, solveCapSolver } from './capSolverClient.js';

const receipts = new WeakMap();

// Executed in the selected form's browsing context. Supports explicit widgets and reCAPTCHA anchor frames.
export function inspectCapSolverWidgets(formSelector) {
  const root = formSelector ? document.querySelector(formSelector) : document;
  if (!root) return [];
  const result = [];
  const add = (host, key, provider, params) => {
    if (!key) return;
    let id = host.getAttribute('data-contact-capsolver-widget');
    if (!id) { id = `cs-${Date.now()}-${Math.random().toString(36).slice(2)}`; host.setAttribute('data-contact-capsolver-widget', id); }
    if (result.some((item) => item.id === id)) return;
    result.push({ id, key, provider, invisible: host.getAttribute('data-size') === 'invisible',
      enterprise: [...document.scripts].some((script) => /recaptcha\/enterprise\.js/.test(script.src)),
      action: host.getAttribute('data-action') || params?.get('sa') || '', cdata: host.getAttribute('data-cdata') || '',
      dataS: host.getAttribute('data-s') || params?.get('s') || '', apiDomain: params?.get('apiDomain') || '',
    });
  };
  for (const host of root.querySelectorAll('.g-recaptcha[data-sitekey],.cf-turnstile[data-sitekey],.h-captcha[data-sitekey]')) {
    add(host, host.getAttribute('data-sitekey'), host.matches('.cf-turnstile') ? 'turnstile' : host.matches('.h-captcha') ? 'hcaptcha' : 'recaptcha');
  }
  for (const frame of root.querySelectorAll('iframe[src]')) {
    let url; try { url = new URL(frame.src, location.href); } catch { continue; }
    if (!/(^|\.)(google\.com|recaptcha\.net)$/.test(url.hostname) || !/\/recaptcha\/(api2|enterprise)\/anchor/.test(url.pathname)) continue;
    const host = frame.closest('.g-recaptcha') || frame.parentElement;
    add(host, url.searchParams.get('k'), 'recaptcha', url.searchParams);
    const widget = result.find((item) => item.id === host.getAttribute('data-contact-capsolver-widget'));
    if (widget) { widget.enterprise ||= url.pathname.includes('/enterprise/'); widget.invisible ||= url.searchParams.get('size') === 'invisible'; widget.action ||= url.searchParams.get('sa') || ''; widget.dataS ||= url.searchParams.get('s') || ''; if (/(^|\.)recaptcha\.net$/.test(url.hostname)) widget.apiDomain = 'www.recaptcha.net'; }
  }
  return result;
}

export function capSolverTask(widget, websiteURL) {
  if (!['recaptcha', 'turnstile'].includes(widget.provider)) throw new CapSolverError('This integration does not support this CAPTCHA provider; complete it manually.', 'CAPSOLVER_UNSUPPORTED');
  const task = { type: widget.provider === 'turnstile' ? 'AntiTurnstileTaskProxyLess' : widget.enterprise ? 'ReCaptchaV2EnterpriseTaskProxyLess' : 'ReCaptchaV2TaskProxyLess', websiteURL, websiteKey: widget.key };
  if (widget.provider === 'recaptcha') {
    task.isInvisible = widget.invisible === true;
    if (widget.action) task.pageAction = widget.action;
    if (widget.apiDomain) task.apiDomain = widget.apiDomain;
    if (widget.dataS) { if (widget.enterprise) task.enterprisePayload = { s: widget.dataS }; else task.recaptchaDataSValue = widget.dataS; }
  } else if (widget.action || widget.cdata) task.metadata = { ...(widget.action ? { action: widget.action } : {}), ...(widget.cdata ? { cdata: widget.cdata } : {}) };
  return task;
}

// Only invokes the callback associated with this widget; never a page-wide collection of callbacks.
export async function applyCapSolverResponse({ widget, token }) {
  const host = document.querySelector(`[data-contact-capsolver-widget="${widget.id}"]`);
  if (!host) return false;
  const name = widget.provider === 'turnstile' ? 'cf-turnstile-response' : 'g-recaptcha-response';
  const form = host.closest('form');
  let fields = [...host.querySelectorAll(`[name="${name}"]`)];
  if (!fields.length && form) {
    const candidates = [...form.querySelectorAll(`[name="${name}"]`)];
    if (candidates.length === 1) fields = candidates;
  }
  let callback; let receiver = window;
  const callbackName = host.getAttribute('data-callback');
  if (callbackName) {
    const path = callbackName.split('.');
    for (const part of path.slice(0, -1)) receiver = receiver?.[part];
    callback = receiver?.[path.at(-1)];
  }
  if (!callback && widget.provider === 'recaptcha') {
    const clients = window.___grecaptcha_cfg?.clients ?? {};
    for (const client of Object.values(clients)) {
      const seen = new Set(); let associated = false; const callbacks = [];
      const visit = (value, depth) => {
        if (!value || typeof value !== 'object' || seen.has(value) || depth > 6 || value === window || value === document) return;
        if (value instanceof Element) { associated ||= value === host || value.contains(host) || host.contains(value); return; }
        seen.add(value);
        for (const key of Object.keys(value)) {
          let child; try { child = value[key]; } catch { continue; }
          if (key === 'callback' && typeof child === 'function') callbacks.push({ callback: child, receiver: value });
          else if (typeof child === 'object') visit(child, depth + 1);
        }
      };
      visit(client, 0);
      if (associated && callbacks.length === 1) { ({ callback, receiver } = callbacks[0]); break; }
    }
  }
  if (!fields.length && typeof callback !== 'function') return false;
  for (const field of fields) { field.value = token; field.dispatchEvent(new Event('input', { bubbles: true })); field.dispatchEvent(new Event('change', { bubbles: true })); }
  if (typeof callback === 'function') await callback.call(receiver, token);
  return true;
}

export async function solveWidgetCapSolver({ page, formSelector, settings, signal, solve = solveCapSolver } = {}) {
  const widgets = await page.evaluate(inspectCapSolverWidgets, formSelector);
  if (!widgets.length) throw new CapSolverError('No supported CAPTCHA site key found in the selected form.', 'CAPSOLVER_WIDGET_NOT_FOUND');
  // Validate all widget types before creating any billable tasks.
  for (const widget of widgets) capSolverTask(widget, page.url());
  const entries = [];
  for (const widget of widgets) {
    const url = page.url();
    const solution = await solve(capSolverTask(widget, url), { ...settings, signal });
    const token = widget.provider === 'turnstile' ? solution.token : solution.gRecaptchaResponse;
    if (typeof token !== 'string' || token.trim().length < 20) throw new CapSolverError('CapSolver returned no usable widget response.');
    if (signal?.aborted) throw signal.reason ?? new Error('Stopped');
    if (page.url() !== url) throw new CapSolverError('The page changed while solving; response was not applied.');
    if (!await page.evaluate(applyCapSolverResponse, { widget, token })) throw new CapSolverError('No supported response field or callback found for this widget.', 'CAPSOLVER_CALLBACK_MISSING');
    entries.push({ widget, token, url, appliedAt: Date.now() });
  }
  const receipt = {}; receipts.set(receipt, { page, formSelector, entries });
  return { method: 'capsolver', receipt, widgets: entries.length };
}

// This establishes that an external response is ready to submit, not that the website accepted it.
export async function isCapSolverResponseReady({ page, formSelector, receipt, detection } = {}) {
  const record = receipt && receipts.get(receipt);
  if (!record || record.page !== page || record.formSelector !== formSelector || !record.entries.length) return false;
  const required = (detection?.captchas ?? []).filter((item) => item.requiresVerification);
  if (required.some((item) => !['recaptcha_v2', 'recaptcha_v2_invisible', 'turnstile'].includes(item.type))) return false;
  const widgets = await page.evaluate(inspectCapSolverWidgets, formSelector).catch(() => []);
  if (widgets.length !== record.entries.length) return false;
  for (const entry of record.entries) {
    if (page.url() !== entry.url || Date.now() - entry.appliedAt > 90000 || !widgets.some((widget) => widget.id === entry.widget.id && widget.key === entry.widget.key)) return false;
    const present = await page.evaluate(({ widget, token }) => {
      const host = document.querySelector(`[data-contact-capsolver-widget="${widget.id}"]`);
      if (!host) return false;
      const name = widget.provider === 'turnstile' ? 'cf-turnstile-response' : 'g-recaptcha-response';
      const fields = [...host.querySelectorAll(`[name="${name}"]`)];
      if (!fields.length) fields.push(...(host.closest('form')?.querySelectorAll(`[name="${name}"]`) ?? []));
      return fields.some((field) => field.value === token);
    }, entry).catch(() => false);
    if (!present) return false;
  }
  return true;
}
