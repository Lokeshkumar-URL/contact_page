import { timingSafeEqual } from 'node:crypto';
import { AppError } from '../errors/AppError.js';

const sameSecret = (expected, provided) => {
  const a = Buffer.from(expected); const b = Buffer.from(provided);
  return a.length === b.length && timingSafeEqual(a, b);
};
const bearer = (req) => req.get('authorization')?.replace(/^Bearer\s+/i, '') ?? '';

/**
 * Accepts either a signed-in user's session token or the optional static API_AUTH_TOKEN
 * (kept for scripts and service-to-service calls). Without an auth service and without a
 * static token the API stays open, as before.
 */
export function createApiAuthenticator(expected, authService) {
  return async function authenticate(req, _res, next) {
    try {
      if (!expected && !authService) return next();
      const provided = bearer(req);
      if (expected && provided && sameSecret(expected, provided)) { req.user = { id: 'api-token', username: 'api-token', role: 'service' }; return next(); }
      const user = authService && provided ? await authService.authenticate(provided) : null;
      if (user) { req.user = user; return next(); }
      return next(new AppError(401, 'UNAUTHORIZED', 'Please sign in to continue.'));
    } catch (error) { return next(error); }
  };
}

export function requireAdmin(req, _res, next) {
  if (req.user?.role !== 'admin') return next(new AppError(403, 'FORBIDDEN', 'Administrator access is required.'));
  return next();
}
