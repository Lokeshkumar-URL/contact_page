import { Router } from 'express';
import { z } from 'zod';
import { rateLimit } from '../middleware/rateLimit.js';
import { validateRequest } from '../middleware/validateRequest.js';

const username = z.string().trim().regex(/^[a-zA-Z0-9._-]{3,32}$/, 'Use 3-32 letters, numbers, dots, dashes or underscores.');
const email = z.string().trim().email().max(254);
const password = z.string().min(10, 'Use at least 10 characters.').max(128).refine((v) => /[a-zA-Z]/.test(v) && /\d/.test(v), 'Include at least one letter and one number.');
const token = z.object({ token: z.string().min(20).max(200) });

export function createAuthRouter({ authService, authenticate }) {
  const router = Router();
  const limited = rateLimit({ max: 20 });
  const wrap = (fn) => (req, res, next) => Promise.resolve(fn(req, res)).catch(next);

  router.get('/status', wrap(async (_req, res) => res.json(await authService.status())));
  router.post('/setup', limited, validateRequest({ body: z.object({ username, email, password }).strict() }), wrap(async (req, res) => res.status(201).json(await authService.setup(req.body))));
  router.post('/login', limited, validateRequest({ body: z.object({ identifier: z.string().trim().min(1).max(254), password: z.string().min(1).max(128) }).strict() }), wrap(async (req, res) => res.json(await authService.login(req.body))));
  router.get('/me', authenticate, (req, res) => res.json({ user: req.user }));
  router.get('/invites/:token', limited, validateRequest({ params: token }), wrap(async (req, res) => res.json(await authService.inspectInvite(req.params.token))));
  router.post('/invites/:token/accept', limited, validateRequest({ params: token, body: z.object({ username, password }).strict() }), wrap(async (req, res) => res.status(201).json(await authService.acceptInvite(req.params.token, req.body))));
  return router;
}

export function createAdminRouter({ authService }) {
  const router = Router();
  const wrap = (fn) => (req, res, next) => Promise.resolve(fn(req, res)).catch(next);
  const id = z.object({ id: z.string().uuid() });
  const role = z.enum(['admin', 'user']);

  router.get('/users', wrap(async (_req, res) => res.json({ users: await authService.listUsers() })));
  router.patch('/users/:id', validateRequest({ params: id, body: z.object({ role: role.optional(), status: z.enum(['active', 'disabled']).optional() }).strict().refine((v) => v.role || v.status, 'Nothing to update.') }), wrap(async (req, res) => res.json({ user: await authService.updateUser(req.params.id, req.body, req.user) })));
  router.delete('/users/:id', validateRequest({ params: id }), wrap(async (req, res) => { await authService.deleteUser(req.params.id, req.user); res.status(204).end(); }));

  router.get('/invites', wrap(async (_req, res) => res.json({ invites: await authService.listInvites() })));
  router.post('/invites', validateRequest({ body: z.object({ email, role: role.default('user') }).strict() }), wrap(async (req, res) => res.status(201).json({ invite: await authService.invite(req.body, req.user) })));
  router.post('/invites/:id/resend', validateRequest({ params: id }), wrap(async (req, res) => res.json({ invite: await authService.resendInvite(req.params.id, req.user) })));
  router.delete('/invites/:id', validateRequest({ params: id }), wrap(async (req, res) => { await authService.revokeInvite(req.params.id); res.status(204).end(); }));
  return router;
}
