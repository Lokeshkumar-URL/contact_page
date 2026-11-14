import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { access, mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { after, before, test } from 'node:test';
import { createApp } from '../src/app.js';
import { appendRunResult, createRun, getRun, runs, setRunStatus, updateProgress } from '../src/services/automation/jobState.js';
import { SCREENSHOT_DIRECTORY } from '../src/services/browser/screenshotService.js';

let server; let baseUrl; let dir; let adminToken; let adminId; let bobToken; let bobId; const mail = []; const files = [];

async function call(method, route, { body, token } = {}) {
  const response = await fetch(`${baseUrl}/api${route}`, { method, headers: { ...(body ? { 'Content-Type': 'application/json' } : {}), ...(token ? { Authorization: `Bearer ${token}` } : {}) }, body: body ? JSON.stringify(body) : undefined });
  return { status: response.status, body: response.status === 204 ? null : await response.json() };
}
const exists = (file) => access(file).then(() => true, () => false);

// Creates a finished run with three results, the first of which has a screenshot on disk.
async function makeRun(owner, { finished = true } = {}) {
  const run = createRun({ spreadsheetId: `s-${randomUUID()}`, sheetName: 'Websites', dryRun: true });
  run.startedBy = owner;
  await mkdir(SCREENSHOT_DIRECTORY, { recursive: true });
  const screenshot = path.join(SCREENSHOT_DIRECTORY, `delete-test-${randomUUID()}.png`); files.push(screenshot);
  await writeFile(screenshot, 'png');
  appendRunResult(run.runId, { id: 'a', rowNumber: 2, url: 'https://a.test', status: 'success', screenshot });
  appendRunResult(run.runId, { id: 'b', rowNumber: 3, url: 'https://b.test', status: 'failed', screenshot: '' });
  appendRunResult(run.runId, { id: 'c', rowNumber: 4, url: 'https://c.test', status: 'manual_review', screenshot: '' });
  updateProgress(run.runId, { total: 3, processed: 3, success: 1, failed: 1, manualReview: 1 });
  if (finished) setRunStatus(run.runId, 'completed');
  return { run, screenshot };
}

before(async () => {
  dir = await mkdtemp(path.join(tmpdir(), 'del-'));
  const mailer = { configured: true, async sendInvite(message) { mail.push(message); return { sent: true }; } };
  server = createApp({ usersFile: path.join(dir, 'users.json'), googleAccountsFile: path.join(dir, 'accounts.json'), mailer }).listen(0);
  await new Promise((resolve) => server.once('listening', resolve));
  baseUrl = `http://127.0.0.1:${server.address().port}`;
  const setup = (await call('POST', '/auth/setup', { body: { username: 'boss', email: 'boss@example.com', password: 'Sup3rSecret!!' } })).body;
  adminToken = setup.token; adminId = setup.user.id;
  await call('POST', '/admin/invites', { token: adminToken, body: { email: 'bob@example.com' } });
  const bob = (await call('POST', `/auth/invites/${mail.at(-1).link.split('/invite/')[1]}/accept`, { body: { username: 'bob', password: 'BobPassw0rd!!' } })).body;
  bobToken = bob.token; bobId = bob.user.id;
});
after(async () => { runs.clear(); await Promise.all(files.map((f) => rm(f, { force: true }))); await new Promise((resolve) => server.close(resolve)); await rm(dir, { recursive: true, force: true }); });

test('deleting a run removes it and its screenshots, but never an active run', async () => {
  const { run, screenshot } = await makeRun(adminId, { finished: false });
  assert.equal((await call('DELETE', `/automation/${run.runId}`, { token: adminToken })).status, 409, 'active runs are protected');
  assert.equal(await exists(screenshot), true);
  setRunStatus(run.runId, 'stopped');
  assert.equal((await call('DELETE', `/automation/${run.runId}`, { token: adminToken })).status, 204);
  assert.equal(getRun(run.runId), undefined);
  assert.equal(await exists(screenshot), false, 'screenshot file is cleaned up');
  assert.equal((await call('GET', `/automation/${run.runId}`, { token: adminToken })).status, 404);
  assert.equal((await call('DELETE', `/automation/${run.runId}`, { token: adminToken })).status, 404);
});

test('members can only delete their own runs; admins can delete any', async () => {
  const adminsRun = (await makeRun(adminId)).run; const bobsRun = (await makeRun(bobId)).run;
  assert.equal((await call('DELETE', `/automation/${adminsRun.runId}`, { token: bobToken })).status, 403);
  assert.equal((await call('DELETE', `/automation/${bobsRun.runId}`, { token: bobToken })).status, 204);
  assert.equal((await call('DELETE', `/automation/${adminsRun.runId}`, { token: adminToken })).status, 204);
});

test('bulk delete reports what was deleted and what was skipped', async () => {
  const mine = (await makeRun(bobId)).run; const notMine = (await makeRun(adminId)).run; const active = (await makeRun(bobId, { finished: false })).run;
  const result = await call('POST', '/automation/bulk-delete', { token: bobToken, body: { runIds: [mine.runId, notMine.runId, active.runId, randomUUID()] } });
  assert.equal(result.status, 200); assert.deepEqual(result.body.deleted, [mine.runId]); assert.equal(result.body.skipped.length, 3);
  assert.equal((await call('POST', '/automation/bulk-delete', { token: bobToken, body: { runIds: [] } })).status, 400);
});

test('deleting submission activity removes rows, files and keeps progress consistent', async () => {
  const { run, screenshot } = await makeRun(bobId);
  assert.equal((await call('DELETE', `/results/${run.runId}/2`, { token: adminToken })).status, 200);
  assert.equal(await exists(screenshot), false);
  assert.deepEqual(getRun(run.runId).results.map((r) => r.rowNumber), [3, 4]);
  assert.deepEqual({ ...getRun(run.runId).progress }, { ...getRun(run.runId).progress, total: 2, processed: 2, success: 0, failed: 1, manualReview: 1 });
  assert.equal((await call('DELETE', `/results/${run.runId}/2`, { token: adminToken })).status, 404, 'already deleted');

  const other = (await makeRun(adminId)).run;
  assert.equal((await call('POST', `/results/${other.runId}/bulk-delete`, { token: bobToken, body: { rowNumbers: [3, 4] } })).status, 403);
  const bulk = await call('POST', `/results/${run.runId}/bulk-delete`, { token: bobToken, body: { rowNumbers: [3, 4] } });
  assert.deepEqual(bulk.body.deleted, [3, 4]); assert.equal(getRun(run.runId).progress.total, 0);

  const live = (await makeRun(bobId, { finished: false })).run;
  assert.equal((await call('DELETE', `/results/${live.runId}/3`, { token: bobToken })).status, 409);
});
