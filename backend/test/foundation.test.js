import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdir, unlink, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { after, before, test } from 'node:test';
import { createApp } from '../src/app.js';
import { loadEnv } from '../src/config/env.js';
import { createLogger } from '../src/utils/logger.js';
import { validateConfig } from '../src/validators/configValidator.js';
import { appendRunResult, createRun, runs } from '../src/services/automation/jobState.js';
import { configureAutomationRuntimeForTests, resetAutomationRuntimeForTests } from '../src/services/automation/automationRuntime.js';
import { SCREENSHOT_DIRECTORY } from '../src/services/browser/screenshotService.js';

let server; let baseUrl;
before(async () => {
  configureAutomationRuntimeForTests({ createSheetsClient: () => ({}), createClaudeClient: () => null, runAutomation: async ({ runId }) => runs.get(runId), logger: { error() {} } });
  server = createApp({ apiAuthToken: '123456789012345678901234' }).listen(0);
  await new Promise((resolve) => server.once('listening', resolve));
  baseUrl = `http://127.0.0.1:${server.address().port}`;
});
after(async () => { resetAutomationRuntimeForTests(); runs.clear(); await new Promise((resolve) => server.close(resolve)); });

const auth = { Authorization: 'Bearer 123456789012345678901234' };
async function request(path, options = {}) { return fetch(`${baseUrl}${path}`, { ...options, headers: { ...auth, ...(options.body ? { 'Content-Type': 'application/json' } : {}), ...options.headers } }); }

test('environment validation applies safe defaults and rejects unsafe production config', () => {
  const value = loadEnv({ NODE_ENV: 'test' });
  assert.equal(value.port, 5173); assert.equal(value.dryRun, true); assert.equal(value.batchSize, 10);
  assert.throws(() => loadEnv({ NODE_ENV: 'production' }), /API_AUTH_TOKEN is required/);
  assert.throws(() => loadEnv({ NODE_ENV: 'test', PORT: '70000' }), /Invalid environment configuration/);
});

test('configuration validation normalizes values and rejects unknown fields', () => {
  const config = validateConfig({ spreadsheetId: ' sheet-1 ', sheetName: 'Websites', batchSize: '5', concurrency: 2, timeoutSeconds: 45, browserMode: 'visible', dryRun: true });
  assert.equal(config.spreadsheetId, 'sheet-1'); assert.equal(config.batchSize, 5);
  assert.throws(() => validateConfig({ spreadsheetId: 'x', secret: 'not-allowed' }));
});

test('structured logger emits JSON and honors its level', () => {
  const lines = []; const logger = createLogger({ level: 'info', sink: { log: (line) => lines.push(line), warn: (line) => lines.push(line), error: (line) => lines.push(line) } });
  logger.debug('hidden'); logger.info('ready', { runId: 'run-1' });
  assert.equal(lines.length, 1); assert.deepEqual(JSON.parse(lines[0]).message, 'ready');
});

test('health is public while protected API routes require a bearer token', async () => {
  assert.equal((await fetch(`${baseUrl}/api/health`)).status, 200);
  const unauthorized = await fetch(`${baseUrl}/api/configuration`);
  assert.equal(unauthorized.status, 401); assert.equal((await unauthorized.json()).error.code, 'UNAUTHORIZED');
  assert.equal((await request('/api/configuration')).status, 200);
});

test('request validation and centralized errors return consistent payloads', async () => {
  const invalid = await request('/api/configuration/validate', { method: 'POST', body: JSON.stringify({ spreadsheetId: '', batchSize: 99 }) });
  assert.equal(invalid.status, 400); const payload = await invalid.json(); assert.equal(payload.error.code, 'VALIDATION_ERROR'); assert.ok(payload.requestId);
  const missing = await request('/api/no-such-route'); assert.equal(missing.status, 404); assert.equal((await missing.json()).error.code, 'ROUTE_NOT_FOUND');
});

test('field-mapping registry endpoints are authenticated and validated', async () => {
  const listed=await request('/api/field-mappings');assert.equal(listed.status,200);const payload=await listed.json();assert.ok(Array.isArray(payload.pending));assert.ok(Array.isArray(payload.approved));
  const invalid=await request('/api/field-mappings/not-valid/approve',{method:'POST',body:JSON.stringify({value:'Approved'})});assert.equal(invalid.status,400);assert.equal((await invalid.json()).error.code,'VALIDATION_ERROR');
});

test('automation controllers create and transition an in-memory run', async () => {
  const started = await request('/api/automation/start', { method: 'POST', body: JSON.stringify({ dryRun: true }) });
  assert.equal(started.status, 202); const run = await started.json(); assert.equal(run.status, 'queued');
  const paused = await request(`/api/automation/${run.runId}/pause`, { method: 'POST' }); assert.equal((await paused.json()).status, 'paused');
  const resumed = await request(`/api/automation/${run.runId}/resume`, { method: 'POST' }); assert.equal((await resumed.json()).status, 'queued');
  const stopped = await request(`/api/automation/${run.runId}/stop`, { method: 'POST' }); assert.equal((await stopped.json()).status, 'stopped');
  const conflict = await request(`/api/automation/${run.runId}/pause`, { method: 'POST' }); assert.equal(conflict.status, 409); assert.equal((await conflict.json()).error.code, 'INVALID_RUN_STATE');
});

test('authenticated screenshot endpoint serves evidence from the stable storage directory', async () => {
  await mkdir(SCREENSHOT_DIRECTORY,{recursive:true});const filename=`test-${randomUUID()}.png`;const screenshot=path.join(SCREENSHOT_DIRECTORY,filename);
  try {
    await writeFile(screenshot,Buffer.from('screenshot-evidence'));
    const run=createRun({spreadsheetId:`sheet-${randomUUID()}`,sheetName:'Websites',dryRun:true});appendRunResult(run.runId,{id:'2',rowNumber:2,url:'https://example.test',status:'failed',screenshot});
    const listed=await request(`/api/results/${run.runId}`);const payload=await listed.json();assert.equal(payload.results[0].screenshot,`/api/results/${run.runId}/screenshots/${filename}`);
    const asset=await request(payload.results[0].screenshot);assert.equal(asset.status,200);assert.equal(await asset.text(),'screenshot-evidence');
  } finally { await unlink(screenshot).catch(()=>{}); }
});
