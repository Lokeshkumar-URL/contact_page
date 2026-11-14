import assert from 'node:assert/strict';
import { generateKeyPairSync } from 'node:crypto';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { after, before, test } from 'node:test';
import { createApp } from '../src/app.js';
import { runs } from '../src/services/automation/jobState.js';
import { configureAutomationRuntimeForTests, getAutomationTask, resetAutomationRuntimeForTests } from '../src/services/automation/automationRuntime.js';

let server; let baseUrl; let dir; let adminToken; const mail = []; const opened = []; let sheetsBehaviour;
const { privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048, privateKeyEncoding: { type: 'pkcs8', format: 'pem' }, publicKeyEncoding: { type: 'spki', format: 'pem' } });
const keyFile = (email) => JSON.stringify({ type: 'service_account', client_email: email, private_key: privateKey });

async function call(method, route, { body, token } = {}) {
  const response = await fetch(`${baseUrl}/api${route}`, { method, headers: { ...(body ? { 'Content-Type': 'application/json' } : {}), ...(token ? { Authorization: `Bearer ${token}` } : {}) }, body: body ? JSON.stringify(body) : undefined });
  return { status: response.status, body: response.status === 204 ? null : await response.json() };
}

before(async () => {
  dir = await mkdtemp(path.join(tmpdir(), 'gacc-'));
  const mailer = { configured: true, async sendInvite(message) { mail.push(message); return { sent: true }; } };
  const createSheetsClient = (credentials) => ({ spreadsheets: { get: async () => { if (sheetsBehaviour) throw sheetsBehaviour; return { data: { properties: { title: 'Leads' }, sheets: [{ properties: { title: 'Websites' } }, { properties: { title: 'Archive' } }] } }; } }, _credentials: credentials });
  configureAutomationRuntimeForTests({ createSheetsClient: (credentials) => { opened.push(credentials); return {}; }, createClaudeClient: () => null, runAutomation: async ({ runId }) => runs.get(runId), logger: { error() {} } });
  server = createApp({ usersFile: path.join(dir, 'users.json'), googleAccountsFile: path.join(dir, 'accounts.json'), mailer, createSheetsClient, googleServiceAccountEmail: 'default@proj.iam.gserviceaccount.com', googlePrivateKey: privateKey }).listen(0);
  await new Promise((resolve) => server.once('listening', resolve));
  baseUrl = `http://127.0.0.1:${server.address().port}`;
  adminToken = (await call('POST', '/auth/setup', { body: { username: 'boss', email: 'boss@example.com', password: 'Sup3rSecret!!' } })).body.token;
});
after(async () => { resetAutomationRuntimeForTests(); runs.clear(); await new Promise((resolve) => server.close(resolve)); await rm(dir, { recursive: true, force: true }); });

test('saved Google accounts are encrypted, private to their owner, and never returned', async () => {
  assert.equal((await call('POST', '/google/accounts', { token: adminToken, body: { label: 'Bad', credentials: '{"nope":true, "padding":"xxxxxxxxxxxxxxxxx"}' } })).status, 400);
  const added = await call('POST', '/google/accounts', { token: adminToken, body: { label: 'Client A', credentials: keyFile('a@proj.iam.gserviceaccount.com') } });
  assert.equal(added.status, 201); assert.equal(added.body.account.clientEmail, 'a@proj.iam.gserviceaccount.com');
  assert.equal(JSON.stringify(added.body).includes('PRIVATE KEY'), false);
  assert.equal((await call('POST', '/google/accounts', { token: adminToken, body: { credentials: keyFile('a@proj.iam.gserviceaccount.com') } })).status, 409);

  const onDisk = await readFile(path.join(dir, 'accounts.json'), 'utf8');
  assert.equal(onDisk.includes('PRIVATE KEY'), false, 'private key must not be stored in plain text');

  const list = (await call('GET', '/google/accounts', { token: adminToken })).body;
  assert.equal(list.accounts.length, 1); assert.equal(list.serverDefault.configured, true);
  assert.equal(list.serverDefault.clientEmail, 'default@proj.iam.gserviceaccount.com');
});

test('connection test explains problems and lists tabs', async () => {
  const accountId = (await call('GET', '/google/accounts', { token: adminToken })).body.accounts[0].id;
  const url = 'https://docs.google.com/spreadsheets/d/1AbC_def-123/edit#gid=0';
  const ok = await call('POST', '/google/test', { token: adminToken, body: { spreadsheetId: url, sheetName: 'websites', googleAccountId: accountId } });
  assert.equal(ok.status, 200); assert.equal(ok.body.spreadsheetId, '1AbC_def-123'); assert.deepEqual(ok.body.tabs, ['Websites', 'Archive']); assert.equal(ok.body.tabFound, true);
  assert.equal((await call('POST', '/google/test', { token: adminToken, body: { spreadsheetId: 'x', sheetName: 'Missing' } })).body.tabFound, false, 'server default account works too');

  sheetsBehaviour = Object.assign(new Error('forbidden'), { code: 403 });
  const denied = await call('POST', '/google/test', { token: adminToken, body: { spreadsheetId: 'x', googleAccountId: accountId } });
  assert.equal(denied.status, 403); assert.match(denied.body.error.message, /a@proj\.iam\.gserviceaccount\.com/);
  sheetsBehaviour = null;
});

test('a run opens Sheets with the chosen account, and other users cannot use it', async () => {
  const accountId = (await call('GET', '/google/accounts', { token: adminToken })).body.accounts[0].id;
  const started = await call('POST', '/automation/start', { token: adminToken, body: { spreadsheetId: 'https://docs.google.com/spreadsheets/d/SHEET123/edit', sheetName: 'Websites', googleAccountId: accountId } });
  assert.equal(started.status, 202); assert.equal(started.body.configuration.spreadsheetId, 'SHEET123');
  await getAutomationTask(started.body.runId);
  assert.equal(opened.at(-1).clientEmail, 'a@proj.iam.gserviceaccount.com');
  assert.match(opened.at(-1).privateKey, /PRIVATE KEY/);

  // A second user (invited and accepted) must not be able to use the admin's saved account.
  assert.equal((await call('POST', '/admin/invites', { token: adminToken, body: { email: 'bob@example.com' } })).status, 201);
  const inviteToken = mail.at(-1).link.split('/invite/')[1];
  const bob = (await call('POST', `/auth/invites/${inviteToken}/accept`, { body: { username: 'bob', password: 'BobPassw0rd!!' } })).body.token;
  assert.equal((await call('POST', '/automation/start', { token: bob, body: { spreadsheetId: 'S', googleAccountId: accountId } })).status, 404);
  assert.equal((await call('GET', '/google/accounts', { token: bob })).body.accounts.length, 0);

  assert.equal((await call('DELETE', `/google/accounts/${accountId}`, { token: adminToken })).status, 204);
  assert.equal((await call('POST', '/automation/start', { token: adminToken, body: { spreadsheetId: 'S', googleAccountId: accountId } })).status, 404);
});
