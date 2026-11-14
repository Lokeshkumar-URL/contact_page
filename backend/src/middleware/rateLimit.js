import { AppError } from '../errors/AppError.js';

/** Minimal in-memory fixed-window limiter, keyed by client IP. */
export function rateLimit({ windowMs = 15 * 60e3, max = 20 } = {}) {
  const hits = new Map();
  return function limiter(req, _res, next) {
    const now = Date.now();
    const key = req.ip ?? 'unknown';
    const entry = hits.get(key);
    if (!entry || entry.resetAt <= now) hits.set(key, { count: 1, resetAt: now + windowMs });
    else if (++entry.count > max) return next(new AppError(429, 'RATE_LIMITED', 'Too many attempts. Please wait a few minutes and try again.'));
    if (hits.size > 5000) for (const [k, v] of hits) if (v.resetAt <= now) hits.delete(k);
    return next();
  };
}
