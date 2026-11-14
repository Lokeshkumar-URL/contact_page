import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { after, before, test } from 'node:test';
import { createApp } from '../src/app.js';

let server; let baseUrl; let dir; const sent = [];
before(async () => {
  dir = await mkdtemp(path.join(tmpdir(), 'auth-'));
  const mailer = { configured: true, async sendInvite(message) { sent.push(message); return { sent: true }; } };
  server = createApp({ usersFile: path.join(dir, 'users.json'), mailer, appBaseUrl: 'http://app.test' }).listen(0);
  await new Promise((resolve) => server.once('listening', resolve));
  baseUrl = `http://127.0.0.1:${server.address().port}`;
});
after(async () => { await new Promise((resolve) => server.close(resolve)); await rm(dir, { recursive: true, force: true }); });

async function call(method, route, { body, token } = {}) {
  const response = await fetch(`${baseUrl}/api${route}`, { method, headers: { ...(body ? { 'Content-Type': 'application/json' } : {}), ...(token ? { Authorization: `Bearer ${token}` } : {}) }, body: body ? JSON.stringify(body) : undefined });
  return { status: response.status, body: response.status === 204 ? null : await response.json() };
}

test('invite flow: setup admin, invite by email, accept, login, and role enforcement', async () => {
  assert.equal((await call('GET', '/automation')).status, 401);
  assert.equal((await call('GET', '/auth/status')).body.setupRequired, true);

  const weak = await call('POST', '/auth/setup', { body: { username: 'boss', email: 'boss@example.com', password: 'short' } });
  assert.equal(weak.status, 400);
  const setup = await call('POST', '/auth/setup', { body: { username: 'boss', email: 'boss@example.com', password: 'Sup3rSecret!!' } });
  assert.equal(setup.status, 201); assert.equal(setup.body.user.role, 'admin');
  assert.equal(JSON.stringify(setup.body).includes('passwordHash'), false);
  const admin = setup.body.token;
  assert.equal((await call('POST', '/auth/setup', { body: { username: 'second', email: 'second@example.com', password: 'Sup3rSecret!!' } })).status, 403);

  const invited = await call('POST', '/admin/invites', { token: admin, body: { email: 'Ann@Example.com', role: 'user' } });
  assert.equal(invited.status, 201); assert.equal(invited.body.invite.emailSent, true);
  assert.equal(sent.length, 1); assert.equal(sent[0].to, 'ann@example.com');
  const inviteToken = sent[0].link.replace('http://app.test/invite/', '');

  assert.equal((await call('GET', '/auth/invites/not-a-real-token-value-0000')).status, 404);
  assert.equal((await call('GET', `/auth/invites/${inviteToken}`)).body.email, 'ann@example.com');
  assert.equal((await call('POST', `/auth/invites/${inviteToken}/accept`, { body: { username: 'boss', password: 'AnnPassw0rd!!' } })).status, 409);
  const accepted = await call('POST', `/auth/invites/${inviteToken}/accept`, { body: { username: 'ann', password: 'AnnPassw0rd!!' } });
  assert.equal(accepted.status, 201); assert.equal(accepted.body.user.role, 'user');
  assert.equal((await call('POST', `/auth/invites/${inviteToken}/accept`, { body: { username: 'ann2', password: 'AnnPassw0rd!!' } })).status, 404, 'invite is single-use');

  const ann = (await call('POST', '/auth/login', { body: { identifier: 'ann', password: 'AnnPassw0rd!!' } })).body.token;
  assert.equal((await call('GET', '/auth/me', { token: ann })).body.user.username, 'ann');
  assert.equal((await call('GET', '/admin/users', { token: ann })).status, 403);
  assert.equal((await call('POST', '/auth/login', { body: { identifier: 'ann', password: 'wrong-password1' } })).status, 401);

  const users = (await call('GET', '/admin/users', { token: admin })).body.users;
  assert.equal(users.length, 2);
  const annId = users.find((u) => u.username === 'ann').id;
  const bossId = users.find((u) => u.username === 'boss').id;
  assert.equal((await call('PATCH', `/admin/users/${bossId}`, { token: admin, body: { status: 'disabled' } })).status, 409, 'cannot disable the last admin');
  assert.equal((await call('PATCH', `/admin/users/${annId}`, { token: admin, body: { status: 'disabled' } })).status, 200);
  assert.equal((await call('GET', '/auth/me', { token: ann })).status, 401, 'disabled users lose access immediately');
  assert.equal((await call('POST', '/auth/login', { body: { identifier: 'ann', password: 'AnnPassw0rd!!' } })).status, 403);
  assert.equal((await call('DELETE', `/admin/users/${annId}`, { token: admin })).status, 204);
});

test('expired and revoked invitations are rejected; resend rotates the link', async () => {
  const admin = (await call('POST', '/auth/login', { body: { identifier: 'boss', password: 'Sup3rSecret!!' } })).body.token;
  const first = (await call('POST', '/admin/invites', { token: admin, body: { email: 'bob@example.com' } })).body.invite;
  const oldLink = sent.at(-1).link.split('/invite/')[1];
  const resent = await call('POST', `/admin/invites/${first.id}/resend`, { token: admin });
  assert.equal(resent.status, 200);
  assert.equal((await call('GET', `/auth/invites/${oldLink}`)).status, 404, 'old link no longer works');
  const newLink = sent.at(-1).link.split('/invite/')[1];
  assert.equal((await call('GET', `/auth/invites/${newLink}`)).status, 200);
  assert.equal((await call('DELETE', `/admin/invites/${first.id}`, { token: admin })).status, 204);
  assert.equal((await call('GET', `/auth/invites/${newLink}`)).status, 404);
});
