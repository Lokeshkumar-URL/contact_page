import { createHmac, timingSafeEqual } from 'node:crypto';

const b64 = (value) => Buffer.from(value).toString('base64url');
const mac = (secret, body) => createHmac('sha256', secret).update(body).digest();

export function signSession(secret, { userId, ttlMs, now = Date.now() }) {
  const body = b64(JSON.stringify({ sub: userId, exp: now + ttlMs }));
  return `${body}.${mac(secret, body).toString('base64url')}`;
}

export function verifySession(secret, token, now = Date.now()) {
  const [body, signature] = String(token ?? '').split('.');
  if (!body || !signature) return null;
  const expected = mac(secret, body);
  const provided = Buffer.from(signature, 'base64url');
  if (provided.length !== expected.length || !timingSafeEqual(provided, expected)) return null;
  try {
    const payload = JSON.parse(Buffer.from(body, 'base64url').toString('utf8'));
    return typeof payload.sub === 'string' && payload.exp > now ? payload : null;
  } catch { return null; }
}
