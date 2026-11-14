const RELIABLE_SCORE = 55;
const UNCERTAIN_SCORE = 25;
export const COMMON_CONTACT_PATHS = ['/contact', '/contact-us', '/contactus', '/get-in-touch', '/contact-sales', '/about/contact', '/company/contact', '/get-a-quote', '/quote', '/enquiry', '/inquiry', '/book-a-demo', '/request-a-demo', '/schedule-a-demo', '/demo'];

export class ContactPageNotFoundError extends Error {
  constructor(message = 'No reliable contact page was found.') { super(message); this.name = 'ContactPageNotFoundError'; this.code = 'CONTACT_PAGE_NOT_FOUND'; this.stage = 'contact_discovery'; this.retryable = false; }
}

export function normalizeCandidate(candidate, baseUrl) {
  try {
    const url = new URL(candidate.href, baseUrl); const base = new URL(baseUrl);
    if (!['http:', 'https:'].includes(url.protocol) || url.origin !== base.origin) return null;
    url.hash = ''; return { url: url.href, text: String(candidate.text ?? '').replace(/\s+/g, ' ').trim(), context: candidate.context ?? 'body' };
  } catch { return null; }
}

export function scoreContactCandidate(candidate) {
  const text = candidate.text.toLowerCase(); const path = new URL(candidate.url).pathname.toLowerCase().replace(/\/$/, '');
  let score = 0; const reasons = [];
  const add = (points, reason) => { score += points; reasons.push(reason); };
  if (['/contact', '/contact-us', '/contactus', '/get-in-touch'].includes(path) || /\/contact(?:-us)?(?:\.html?|\.php|\.aspx?)$/.test(path)) add(70, 'exact-contact-path');
  else if (path.includes('contact')) add(42, 'contact-path');
  if (/\bcontact( us)?\b/.test(text)) add(45, 'contact-text');
  else if (/\b(get in touch|reach out|let'?s talk|write to us|send us a message|drop us a line|talk to an expert|speak to (?:sales|an expert|us))\b/.test(text) || /get-in-touch|lets-talk/.test(path)) add(45, 'contact-phrase');
  if (/\b(get a )?quote\b/.test(text) || path.includes('quote')) add(42, 'quote');
  if (/\b(enquiry|inquiry|enquire|inquire)\b/.test(text) || /enquir|inquir/.test(path)) add(38, 'enquiry');
  if (/\b(sales|talk to us|reach us)\b/.test(text)) add(25, 'sales-contact');
  if (/\b(book|request|schedule|get) (a )?demo\b/.test(text) || /(?:book|request)[-_]?(?:a[-_]?)?demo|\/demo\b/.test(path)) add(46, 'demo-form');
  if (/\b(request information|get started|contact sales|talk to sales)\b/.test(text)) add(35, 'lead-form');
  if (['header', 'nav', 'footer'].includes(candidate.context)) add(10, 'navigation-context');
  if (/privacy|terms|career|jobs|login|sign in|news|blog|webinar|investor|help center|faq/.test(`${text} ${path}`)) add(-60, 'negative-signal');
  return { ...candidate, score, reasons };
}

export function rankContactCandidates(rawCandidates, baseUrl) {
  const deduplicated = new Map();
  for (const raw of rawCandidates) { const candidate = normalizeCandidate(raw, baseUrl); if (!candidate) continue; const scored = scoreContactCandidate(candidate); const existing = deduplicated.get(scored.url); if (!existing || scored.score > existing.score) deduplicated.set(scored.url, scored); }
  return [...deduplicated.values()].sort((left, right) => right.score - left.score || left.url.localeCompare(right.url));
}

export function validateSelectedCandidate(selection, candidates, baseUrl) {
  const selected = normalizeCandidate({ href: typeof selection === 'string' ? selection : selection?.url }, baseUrl);
  if (!selected) return null;
  return candidates.find((candidate) => candidate.url === selected.url) ?? null;
}

async function scanPageLinks(page) {
  // Single-page sites often render navigation after DOMContentLoaded; give links a moment to appear.
  if (typeof page.waitForFunction === 'function') await page.waitForFunction(() => document.querySelectorAll('a[href]').length >= 3, { timeout: 4000, polling: 250 }).catch(() => {});
  return page.evaluate(() => [...document.querySelectorAll('a[href]')].map((anchor) => ({ href: anchor.href, text: anchor.innerText || anchor.textContent || anchor.getAttribute('aria-label') || '', context: anchor.closest('footer') ? 'footer' : anchor.closest('nav,[role="navigation"]') ? 'nav' : anchor.closest('header') ? 'header' : 'body' })));
}

async function tryCommonPaths(page, baseUrl, paths, timeout) {
  for (const path of paths) {
    const requestedUrl = new URL(path, baseUrl).href;
    try {
      const response = await page.goto(requestedUrl, { waitUntil: 'domcontentloaded', timeout });
      const finalUrl = page.url(); const valid = normalizeCandidate({ href: finalUrl, text: path, context: 'common-path' }, baseUrl);
      if (valid && (!response || response.status() < 400)) return { ...scoreContactCandidate(valid), score: 90, reasons: ['common-path-success'] };
    } catch { /* Try the next safe path. */ }
  }
  return null;
}

export async function findContactPage({ page, baseUrl = page.url(), resolveWithClaude, commonPaths = COMMON_CONTACT_PATHS, timeout = 10000 } = {}) {
  if (!page) throw new TypeError('A Puppeteer page is required.');
  const ranked = rankContactCandidates(await scanPageLinks(page), baseUrl);
  if (ranked[0]?.score >= RELIABLE_SCORE) return { ...ranked[0], method: 'rules' };
  const commonPath = await tryCommonPaths(page, baseUrl, commonPaths, timeout);
  if (commonPath) return { ...commonPath, method: 'common-path' };
  const uncertain = ranked.filter((candidate) => candidate.score >= UNCERTAIN_SCORE).slice(0, 10);
  if (uncertain.length && resolveWithClaude) {
    const selection = await resolveWithClaude(uncertain); const validated = validateSelectedCandidate(selection, uncertain, baseUrl);
    if (validated) return { ...validated, method: 'claude' };
  }
  throw new ContactPageNotFoundError();
}

export async function findAlternateFormPage({ page, baseUrl = page.url(), resolveWithClaude } = {}) {
  if (!page) throw new TypeError('A Puppeteer page is required.');
  const currentUrl = page.url();
  const ranked = rankContactCandidates(await scanPageLinks(page), baseUrl).filter((candidate) => candidate.url !== currentUrl);
  const reliable = ranked.find((candidate) => candidate.score >= 40 && /quote|enquir|inquir|demo|sales|get-started|request/.test(`${candidate.text} ${new URL(candidate.url).pathname}`.toLowerCase()));
  if (reliable) return { ...reliable, method: 'alternate-rules' };
  const uncertain = ranked.filter((candidate) => candidate.score >= UNCERTAIN_SCORE).slice(0, 10);
  if (uncertain.length && resolveWithClaude) {
    const selection = await resolveWithClaude(uncertain); const validated = validateSelectedCandidate(selection, uncertain, baseUrl);
    if (validated) return { ...validated, method: 'alternate-claude' };
  }
  throw new ContactPageNotFoundError('The contact page had no form and no reliable Demo, Quote, Enquiry, or Sales form link was found.');
}
