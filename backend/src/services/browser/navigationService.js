import { lookup } from 'node:dns/promises';
import { isIP } from 'node:net';

const PRIVATE_V4 = /^(?:10\.|127\.|169\.254\.|192\.168\.|0\.|(?:172\.(?:1[6-9]|2\d|3[01])\.))/;

export class NavigationError extends Error {
  constructor(message, { code = 'NAVIGATION_FAILED', retryable = false, url = '', status, cause } = {}) {
    super(message, { cause }); this.name = 'NavigationError'; this.code = code; this.stage = 'navigation'; this.retryable = retryable; this.url = url; this.status = status;
  }
}

export function isPrivateAddress(address = '') {
  if (isIP(address) === 4) return PRIVATE_V4.test(address) || /^22[4-9]\.|^23\d\./.test(address) || /^24\d\.|^25[0-5]\./.test(address);
  if (isIP(address) === 6) { const value = address.toLowerCase(); return value === '::1' || value === '::' || value.startsWith('fc') || value.startsWith('fd') || /^fe[89ab]/.test(value); }
  return false;
}

export async function assertSafePublicUrl(value, resolveHost = (hostname) => lookup(hostname, { all: true })) {
  let url;
  try { url = new URL(value); } catch { throw new NavigationError('The website URL is invalid.', { code: 'INVALID_URL', url: String(value) }); }
  if (!['http:', 'https:'].includes(url.protocol)) throw new NavigationError('Only HTTP and HTTPS websites are supported.', { code: 'UNSAFE_PROTOCOL', url: url.href });
  if (url.username || url.password) throw new NavigationError('URLs containing credentials are not allowed.', { code: 'URL_CREDENTIALS_BLOCKED', url: url.href });
  const hostname = url.hostname.toLowerCase();
  if (hostname === 'localhost' || hostname.endsWith('.localhost') || hostname.endsWith('.local')) throw new NavigationError('Local network websites are not allowed.', { code: 'PRIVATE_NETWORK_BLOCKED', url: url.href });
  const addresses = isIP(hostname) ? [{ address: hostname }] : await resolveHost(hostname).catch((cause) => { throw new NavigationError('The website hostname could not be resolved.', { code: 'DNS_FAILED', retryable: true, url: url.href, cause }); });
  if (!addresses.length || addresses.some(({ address }) => isPrivateAddress(address))) throw new NavigationError('Private or local network targets are not allowed.', { code: 'PRIVATE_NETWORK_BLOCKED', url: url.href });
  url.hash = ''; return url;
}

export async function navigateSafely({ page, url, timeout = 45000, maxRedirects = 5, waitUntil = 'domcontentloaded', resolveHost } = {}) {
  if (!page) throw new TypeError('A Puppeteer page is required.');
  const target = await assertSafePublicUrl(url, resolveHost);
  let response;
  try { response = await page.goto(target.href, { timeout, waitUntil }); }
  catch (cause) {
    const timedOut = cause?.name === 'TimeoutError' || /timeout/i.test(cause?.message ?? '');
    throw new NavigationError(timedOut ? 'Website navigation timed out.' : 'The website could not be opened.', { code: timedOut ? 'NAVIGATION_TIMEOUT' : 'NAVIGATION_FAILED', retryable: true, url: target.href, cause });
  }
  const finalUrl = page.url(); await assertSafePublicUrl(finalUrl, resolveHost);
  const redirectCount = response?.request?.().redirectChain?.().length ?? 0;
  if (redirectCount > maxRedirects) throw new NavigationError('The website exceeded the redirect limit.', { code: 'TOO_MANY_REDIRECTS', url: finalUrl });
  const status = response?.status?.() ?? 200;
  if (status >= 400) throw new NavigationError(`Website returned HTTP ${status}.`, { code: 'HTTP_ERROR', retryable: status >= 500, url: finalUrl, status });
  return { requestedUrl: target.href, finalUrl, status, redirectCount, redirected: finalUrl !== target.href };
}
