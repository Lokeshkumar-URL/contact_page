/**
 * Minimal FastCaptcha (fastcaptcha.org) client for text/image CAPTCHAs.
 * Synchronous API: one POST returns the solved text directly (no polling).
 * Same request contract as the working client in tn-ec-feasibility/service.
 */
export const FASTCAPTCHA_OCR_URL = 'https://fastcaptcha.org/api/v1/ocr/';

export class FastCaptchaError extends Error {
  constructor(message, { status, body } = {}) { super(message); this.name = 'FastCaptchaError'; this.code = 'FASTCAPTCHA_FAILED'; this.status = status; this.body = body; }
}

export async function solveImageCaptchaFastCaptcha(imageBase64, { apiKey, timeoutMs = 20000, fetchImpl = globalThis.fetch, solvingEnabled = false } = {}) {
  // Second line of defence: the third-party call cannot happen unless solving was explicitly enabled.
  if (!solvingEnabled) throw new FastCaptchaError('Third-party CAPTCHA solving is disabled (set CAPTCHA_SOLVING_ENABLED=true to allow it).');
  if (!apiKey) throw new FastCaptchaError('FastCaptcha API key is not configured.');
  if (!imageBase64) throw new FastCaptchaError('CAPTCHA image is empty.');
  const base64 = String(imageBase64).replace(/^data:image\/[a-z+]+;base64,/i, '');
  let response;
  try {
    response = await fetchImpl(FASTCAPTCHA_OCR_URL, {
      method: 'POST',
      headers: { 'X-API-Key': apiKey, 'content-type': 'application/json' },
      body: JSON.stringify({ base64_image: base64 }),
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch (error) { throw new FastCaptchaError(`FastCaptcha request failed: ${error.message}`); }
  const body = await response.json().catch(() => ({}));
  const text = typeof body?.text === 'string' ? body.text.trim() : '';
  if (!response.ok || !body?.success || !text) {
    // Never echo the API key; the response body does not contain it.
    throw new FastCaptchaError(`FastCaptcha solve failed: HTTP ${response.status} ${body?.error_code ?? body?.error ?? ''}`.trim(), { status: response.status, body });
  }
  return { text, creditsRemaining: body.credits_remaining, processingTime: body.processing_time };
}
