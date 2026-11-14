import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';
import { frontendDashboardTasks } from '../tasks/frontend-dashboard.tasks.js';
import {
  DEFAULT_AUTOMATION_CONFIG,
  normalizeAutomationConfig,
  validateAutomationConfig,
} from '../frontend/src/utils/automationConfig.js';
import {
  DEFAULT_CONTACT_PROFILE,
  normalizeContactProfile,
  validateContactProfile,
} from '../frontend/src/utils/contactProfile.js';
import { INITIAL_RUN_STATE, automationRunReducer, canRunAction } from '../frontend/src/utils/automationRunState.js';
import { EMPTY_PROGRESS, applyProgressEvent, calculateProgressPercent } from '../frontend/src/utils/progress.js';
import { filterResults, summarizeResults } from '../frontend/src/utils/results.js';
import { ApiError, apiRequest, getOperatorErrorMessage, resolveApiAssetUrl } from '../frontend/src/api/httpClient.js';

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), 'utf8');

async function assertModule(path, expectedText) {
  const source = await read(path);
  assert.ok(source.trim().length > 0, `${path} must not be empty`);
  assert.match(source, expectedText, `${path} is missing its expected contract`);
}

test('task registry has unique IDs and a regression contract for every task', () => {
  const ids = frontendDashboardTasks.map(({ id }) => id);
  assert.equal(new Set(ids).size, ids.length);
  assert.deepEqual(ids, Array.from({ length: 9 }, (_, index) => `FE-00${index + 1}`));

  for (const task of frontendDashboardTasks) {
    assert.ok(task.title);
    assert.ok(task.implementation.length > 0);
    assert.ok(task.acceptance.length > 0);
    assert.ok(task.regressionTest.startsWith(`${task.id}:`));
  }
});

test('FE-001: responsive shell, routes, navigation, and page landmarks exist', async () => {
  await assertModule('frontend/src/App.jsx', /path="\/runs\/:runId"/);
  await assertModule('frontend/src/App.jsx', /<Route element={<AppShell \/>}>/);
  await assertModule('frontend/src/App.jsx', /<Navigate to="\/" replace \/>/);
  await assertModule('frontend/src/components/AppShell.jsx', /aria-label="Primary navigation"/);
  await assertModule('frontend/src/components/AppShell.jsx', /<Outlet \/>/);
  await assertModule('frontend/src/pages/DashboardPage.jsx', /aria-labelledby="dashboard-title"/);
  await assertModule('frontend/src/pages/RunDetailsPage.jsx', /useParams/);
  await assertModule('frontend/src/pages/SettingsPage.jsx', /aria-labelledby="settings-title"/);
  await assertModule('frontend/src/styles/global.css', /@media \(max-width: 820px\)/);
  await assertModule('frontend/src/styles/global.css', /:focus-visible/);
  await assertModule('frontend/src/styles/global.css', /prefers-reduced-motion/);
});

test('FE-002: configuration component, defaults, validation, and settings integration work', async () => {
  assert.equal(DEFAULT_AUTOMATION_CONFIG.dryRun, true);
  assert.deepEqual(validateAutomationConfig(DEFAULT_AUTOMATION_CONFIG), {
    spreadsheetId: 'Google Sheet ID is required.',
  });

  const valid = { ...DEFAULT_AUTOMATION_CONFIG, spreadsheetId: ' sheet-id ', batchSize: '10', concurrency: '3', timeoutSeconds: '45' };
  assert.deepEqual(validateAutomationConfig(valid), {});
  assert.deepEqual(normalizeAutomationConfig(valid), {
    ...DEFAULT_AUTOMATION_CONFIG,
    spreadsheetId: 'sheet-id',
  });

  for (const [field, value] of [['batchSize', 11], ['concurrency', 0], ['timeoutSeconds', 9]]) {
    assert.ok(validateAutomationConfig({ ...valid, [field]: value })[field]);
  }

  await assertModule('frontend/src/components/ConfigurationForm.jsx', /Save configuration/);
  await assertModule('frontend/src/components/ConfigurationForm.jsx', /type="checkbox" name="dryRun"/);
  await assertModule('frontend/src/pages/SettingsPage.jsx', /<ConfigurationForm initialConfig={loadAutomationConfig\(\)} onSave={saveAutomationConfig} \/>/);
  await assertModule('frontend/.env.example', /VITE_API_BASE_URL=/);
});

test('FE-003: contact profile defaults, validation, and settings integration work', async () => {
  assert.equal(DEFAULT_CONTACT_PROFILE.firstName, 'Patrick');
  assert.equal(DEFAULT_CONTACT_PROFILE.lastName, 'Joe');
  assert.equal(DEFAULT_CONTACT_PROFILE.message, '');
  assert.deepEqual(validateContactProfile(DEFAULT_CONTACT_PROFILE), {
    message: 'Approved message is required.',
  });

  const valid = { ...DEFAULT_CONTACT_PROFILE, message: ' Hello from Listsassistant. ' };
  assert.deepEqual(validateContactProfile(valid), {});
  assert.equal(normalizeContactProfile(valid).message, 'Hello from Listsassistant.');
  assert.equal(validateContactProfile({ ...valid, email: 'not-an-email' }).email, 'Enter a valid email address.');
  assert.ok(validateContactProfile({ ...valid, phone: '123' }).phone);
  assert.ok(validateContactProfile({ ...valid, message: 'x'.repeat(1001) }).message);
  const custom = normalizeContactProfile({ ...valid, customFields: [{ fieldName: ' Practice size ', aliases: ' Office count ', value: ' 1-5 ' }] });
  assert.deepEqual(custom.customFields, [{ fieldName: 'Practice size', aliases: 'Office count', value: '1-5' }]);
  assert.ok(validateContactProfile({ ...valid, customFields: [{ fieldName: 'Practice size', aliases: '', value: '' }] }).customFields);

  await assertModule('frontend/src/components/ContactProfileForm.jsx', /Save contact profile/);
  await assertModule('frontend/src/components/ContactProfileForm.jsx', /No API keys stored here/);
  await assertModule('frontend/src/components/ContactProfileForm.jsx', /maxLength="1000"/);
  await assertModule('frontend/src/components/ContactProfileForm.jsx', /Custom form fields/);
  await assertModule('frontend/src/components/FieldMappingRegistry.jsx', /Detected field suggestions/);
  await assertModule('frontend/src/components/FieldMappingRegistry.jsx', /This website only/);
  await assertModule('frontend/src/pages/SettingsPage.jsx', /<ContactProfileForm initialProfile={loadContactProfile\(\)} onSave={saveContactProfile} \/>/);
});

test('FE-004: run-control state machine and safety contracts work', async () => {
  assert.equal(canRunAction(INITIAL_RUN_STATE, 'start'), true);
  assert.equal(canRunAction(INITIAL_RUN_STATE, 'pause'), false);
  const requesting = automationRunReducer(INITIAL_RUN_STATE, { type: 'REQUEST', action: 'start' });
  assert.equal(requesting.pendingAction, 'start');
  assert.equal(canRunAction(requesting, 'start'), false);
  const running = automationRunReducer(requesting, { type: 'STARTED', runId: 'run-123' });
  assert.equal(running.status, 'running');
  assert.equal(canRunAction(running, 'pause'), true);
  assert.equal(canRunAction(running, 'stop'), true);
  const paused = automationRunReducer(running, { type: 'PAUSED' });
  assert.equal(paused.status, 'paused');
  assert.equal(canRunAction(paused, 'resume'), true);
  assert.equal(automationRunReducer(paused, { type: 'RESUMED' }).status, 'running');
  assert.equal(automationRunReducer(running, { type: 'STOPPED' }).status, 'stopped');
  await assertModule('frontend/src/components/ControlPanel.jsx', /Start automation/);
  await assertModule('frontend/src/components/ControlPanel.jsx', /liveConfirmed/);
  await assertModule('frontend/src/hooks/useAutomationRun.js', /if \(!canRunAction\(state, action\)\) return false/);
  await assertModule('frontend/src/pages/DashboardPage.jsx', /<ControlPanel run={run} startPayload={startPayload} \/>/);
});

test('FE-005: progress normalization, percentages, and SSE safety work', async () => {
  const progress = applyProgressEvent(EMPTY_PROGRESS, { progress: { total: 10, success: 4, failed: 1 } });
  assert.equal(progress.total, 10);
  assert.equal(progress.success, 4);
  assert.equal(calculateProgressPercent(progress), 50);
  assert.equal(calculateProgressPercent(EMPTY_PROGRESS), 0);
  assert.equal(applyProgressEvent(progress, null), progress);
  await assertModule('frontend/src/components/ProgressSummary.jsx', /aria-labelledby="progress-title"/);
  await assertModule('frontend/src/hooks/useLiveProgress.js', /openAuthenticatedEventStream/);
  await assertModule('frontend/src/hooks/useLiveProgress.js', /controller\.abort\(\)/);
  await assertModule('frontend/src/api/sseClient.js', /Authorization:`Bearer \$\{token\}`/);
  await assertModule('frontend/src/pages/RunDetailsPage.jsx', /useLiveProgress\(runId\)/);
});

test('FE-006: immutable result filtering and status summary work', async () => {
  const results = [
    { id: '1', url: 'https://alpha.example', status: 'success', reason: '' },
    { id: '2', url: 'https://beta.example', status: 'failed', reason: 'CAPTCHA' },
    { id: '3', url: 'https://gamma.example', status: 'manual_review', reason: 'Consent' },
  ];
  assert.deepEqual(filterResults(results, { status: 'failed' }).map(({ id }) => id), ['2']);
  assert.deepEqual(filterResults(results, { query: 'captcha' }).map(({ id }) => id), ['2']);
  assert.equal(results.length, 3);
  const summary = summarizeResults(results);
  assert.equal(summary.total, 3); assert.equal(summary.success, 1); assert.equal(summary.failed, 1); assert.equal(summary.manualReview, 1);
  await assertModule('frontend/src/components/ResultsTable.jsx', /type="search"/);
  await assertModule('frontend/src/components/ResultsTable.jsx', /All statuses/);
  await assertModule('frontend/src/components/StatusBadge.jsx', /RESULT_STATUSES/);
  await assertModule('frontend/src/pages/DashboardPage.jsx', /useRunResults\(viewRunId, live\.eventId\)/);
});

test('FE-007: screenshot viewer has dialog, focus, and keyboard contracts', async () => {
  assert.equal(resolveApiAssetUrl('/api/results/run-1/screenshots/a.png'), 'http://localhost:3000/api/results/run-1/screenshots/a.png');
  await assertModule('frontend/src/components/ScreenshotModal.jsx', /role="dialog"/);
  await assertModule('frontend/src/components/ScreenshotModal.jsx', /aria-modal="true"/);
  await assertModule('frontend/src/components/ScreenshotModal.jsx', /event\.key==='Escape'/);
  await assertModule('frontend/src/components/ScreenshotModal.jsx', /event\.key==='Tab'/);
  await assertModule('frontend/src/components/ScreenshotModal.jsx', /previous\?\.focus\(\)/);
  await assertModule('frontend/src/pages/DashboardPage.jsx', /<ScreenshotModal/);
});

test('FE-008: API client handles JSON, server failures, and safe messages', async () => {
  const ok = await apiRequest('/health', {}, async () => new Response(JSON.stringify({ status: 'ok' }), { status: 200, headers: { 'content-type': 'application/json' } }));
  assert.deepEqual(ok, { status: 'ok' });
  await assert.rejects(
    () => apiRequest('/broken', {}, async () => new Response(JSON.stringify({ message: 'Validation failed' }), { status: 422, headers: { 'content-type': 'application/json' } })),
    (error) => error instanceof ApiError && error.status === 422 && error.message === 'Validation failed',
  );
  assert.equal(getOperatorErrorMessage({ code: 'NETWORK_ERROR' }), 'The automation service is offline or unreachable.');
  assert.equal(getOperatorErrorMessage({ status: 403 }), 'You do not have permission to perform this action.');
  await assertModule('frontend/src/api/httpClient.js', /AbortController/);
  await assertModule('frontend/src/api/httpClient.js', /NETWORK_ERROR/);
  await assertModule('frontend/src/hooks/useAutomationRun.js', /getOperatorErrorMessage\(error\)/);
  await assertModule('frontend/.env.example', /http:\/\/localhost:3000\/api/);
});

test('FE-009: responsive and accessibility contracts exist', async () => {
  await assertModule('frontend/src/components/AppShell.jsx', /Skip to main content/);
  await assertModule('frontend/src/components/AppShell.jsx', /id="main-content" tabIndex="-1"/);
  await assertModule('frontend/src/styles/global.css', /\.sr-only/);
  await assertModule('frontend/src/styles/global.css', /@media \(max-width: 480px\)/);
  await assertModule('frontend/src/styles/global.css', /prefers-reduced-motion/);
  await assertModule('frontend/src/styles/global.css', /:focus-visible/);
});
