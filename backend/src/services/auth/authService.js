import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { AppError } from '../../errors/AppError.js';
import { DUMMY_HASH, hashPassword, verifyPassword } from './passwords.js';
import { signSession, verifySession } from './sessionTokens.js';

const sha256 = (value) => createHash('sha256').update(value).digest('hex');
const lower = (value) => String(value ?? '').trim().toLowerCase();
export const publicUser = (u) => ({ id: u.id, username: u.username, email: u.email, role: u.role, status: u.status, createdAt: u.createdAt, lastLoginAt: u.lastLoginAt ?? null });
const inviteStatus = (i) => (i.acceptedAt ? 'accepted' : Date.parse(i.expiresAt) < Date.now() ? 'expired' : 'pending');
const publicInvite = (i) => ({ id: i.id, email: i.email, role: i.role, invitedBy: i.invitedBy, createdAt: i.createdAt, expiresAt: i.expiresAt, status: inviteStatus(i) });

export function createAuthService({ store, mailer, appBaseUrl, sessionTtlMs = 12 * 3600e3, inviteTtlMs = 72 * 3600e3 }) {
  const usernameTaken = (state, username) => state.users.some((u) => lower(u.username) === lower(username));
  const emailTaken = (state, email) => state.users.some((u) => lower(u.email) === lower(email));
  const activeAdmins = (state) => state.users.filter((u) => u.role === 'admin' && u.status === 'active');
  const issue = async (user) => ({ token: signSession(await store.secret(), { userId: user.id, ttlMs: sessionTtlMs }), expiresAt: new Date(Date.now() + sessionTtlMs).toISOString(), user: publicUser(user) });

  async function createUser(state, { username, email, password, role }) {
    if (usernameTaken(state, username)) throw new AppError(409, 'USERNAME_TAKEN', 'That username is already taken.');
    const user = { id: randomUUID(), username, email: lower(email), role, status: 'active', passwordHash: await hashPassword(password), createdAt: new Date().toISOString(), lastLoginAt: null };
    state.users.push(user);
    return user;
  }

  function findInvite(state, token) {
    const hash = sha256(String(token ?? ''));
    const invite = state.invites.find((i) => i.tokenHash === hash);
    if (!invite || invite.acceptedAt) throw new AppError(404, 'INVITE_INVALID', 'This invitation link is invalid or has already been used.');
    if (Date.parse(invite.expiresAt) < Date.now()) throw new AppError(410, 'INVITE_EXPIRED', 'This invitation has expired. Ask your admin for a new one.');
    return invite;
  }

  async function deliver(invite, token, inviterName) {
    const link = `${appBaseUrl.replace(/\/$/, '')}/invite/${token}`;
    const delivery = await mailer.sendInvite({ to: invite.email, link, invitedBy: inviterName, expiresAt: invite.expiresAt, role: invite.role });
    // When the email cannot be sent the admin gets the link so they can share it by hand.
    return { ...publicInvite(invite), emailSent: delivery.sent, emailError: delivery.sent ? null : delivery.reason, ...(delivery.sent ? {} : { link }) };
  }

  return {
    async status() { return { setupRequired: (await store.read((s) => s.users.length)) === 0, mailConfigured: mailer.configured }; },

    async setup({ username, email, password }) {
      return store.mutate(async (state) => {
        if (state.users.length) throw new AppError(403, 'SETUP_COMPLETE', 'Setup has already been completed.');
        const user = await createUser(state, { username, email, password, role: 'admin' });
        user.lastLoginAt = new Date().toISOString();
        return issue(user);
      });
    },

    async login({ identifier, password }) {
      const id = lower(identifier);
      const user = await store.read((s) => s.users.find((u) => lower(u.username) === id || lower(u.email) === id));
      const ok = await verifyPassword(password, user?.passwordHash ?? DUMMY_HASH);
      if (!user || !ok) throw new AppError(401, 'INVALID_CREDENTIALS', 'Invalid username or password.');
      if (user.status !== 'active') throw new AppError(403, 'ACCOUNT_DISABLED', 'This account has been disabled. Contact your admin.');
      await store.mutate((s) => { const u = s.users.find((x) => x.id === user.id); if (u) u.lastLoginAt = new Date().toISOString(); });
      return issue(user);
    },

    async authenticate(token) {
      const payload = verifySession(await store.secret(), token);
      if (!payload) return null;
      const user = await store.read((s) => s.users.find((u) => u.id === payload.sub));
      return user && user.status === 'active' ? publicUser(user) : null;
    },

    async inspectInvite(token) { return store.read((s) => { const i = findInvite(s, token); return { email: i.email, role: i.role, invitedBy: i.invitedBy, expiresAt: i.expiresAt }; }); },

    async acceptInvite(token, { username, password }) {
      return store.mutate(async (state) => {
        const invite = findInvite(state, token);
        if (emailTaken(state, invite.email)) throw new AppError(409, 'EMAIL_TAKEN', 'An account already exists for this email.');
        const user = await createUser(state, { username, email: invite.email, password, role: invite.role });
        invite.acceptedAt = new Date().toISOString(); user.lastLoginAt = invite.acceptedAt;
        return issue(user);
      });
    },

    async listUsers() { return store.read((s) => s.users.map(publicUser)); },
    async listInvites() { return store.read((s) => s.invites.map(publicInvite).sort((a, b) => b.createdAt.localeCompare(a.createdAt))); },

    async invite({ email, role }, inviter) {
      const token = randomBytes(32).toString('base64url');
      const invite = await store.mutate((state) => {
        if (emailTaken(state, email)) throw new AppError(409, 'EMAIL_TAKEN', 'A user with this email already exists.');
        // A new invitation replaces any still-pending one for the same address.
        state.invites = state.invites.filter((i) => i.acceptedAt || lower(i.email) !== lower(email));
        const now = Date.now();
        const created = { id: randomUUID(), email: lower(email), role, invitedBy: inviter.username, invitedById: inviter.id, tokenHash: sha256(token), createdAt: new Date(now).toISOString(), expiresAt: new Date(now + inviteTtlMs).toISOString(), acceptedAt: null };
        state.invites.push(created);
        return { ...created };
      });
      return deliver(invite, token, inviter.username);
    },

    async resendInvite(id, inviter) {
      const token = randomBytes(32).toString('base64url');
      const invite = await store.mutate((state) => {
        const found = state.invites.find((i) => i.id === id && !i.acceptedAt);
        if (!found) throw new AppError(404, 'INVITE_NOT_FOUND', 'Invitation not found.');
        found.tokenHash = sha256(token); found.expiresAt = new Date(Date.now() + inviteTtlMs).toISOString();
        return { ...found };
      });
      return deliver(invite, token, inviter.username);
    },

    async revokeInvite(id) {
      await store.mutate((state) => { const before = state.invites.length; state.invites = state.invites.filter((i) => i.id !== id); if (state.invites.length === before) throw new AppError(404, 'INVITE_NOT_FOUND', 'Invitation not found.'); });
    },

    async updateUser(id, patch, actor) {
      return store.mutate((state) => {
        const user = state.users.find((u) => u.id === id);
        if (!user) throw new AppError(404, 'USER_NOT_FOUND', 'User not found.');
        const next = { ...user, ...patch };
        const losesAdmin = user.role === 'admin' && user.status === 'active' && (next.role !== 'admin' || next.status !== 'active');
        if (losesAdmin && user.id === actor.id) throw new AppError(409, 'SELF_DEMOTE', 'You cannot remove your own admin access.');
        if (losesAdmin && activeAdmins(state).length <= 1) throw new AppError(409, 'LAST_ADMIN', 'There must be at least one active admin.');
        Object.assign(user, patch);
        return publicUser(user);
      });
    },

    async deleteUser(id, actor) {
      await store.mutate((state) => {
        const user = state.users.find((u) => u.id === id);
        if (!user) throw new AppError(404, 'USER_NOT_FOUND', 'User not found.');
        if (user.id === actor.id) throw new AppError(409, 'SELF_DELETE', 'You cannot delete your own account.');
        if (user.role === 'admin' && user.status === 'active' && activeAdmins(state).length <= 1) throw new AppError(409, 'LAST_ADMIN', 'There must be at least one active admin.');
        state.users = state.users.filter((u) => u.id !== id);
      });
    },
  };
}
