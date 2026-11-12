import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { validateFieldMapping } from '../src/validators/claudeMappingValidator.js';
import { isSafeResultRetry } from '../src/services/automation/automationRuntime.js';
import { clearJobState, createRun, getRun, setRunStatus } from '../src/services/automation/jobState.js';
import { loadRunState, saveRunState } from '../src/services/automation/runPersistence.js';

test.afterEach(() => clearJobState());

test('persists run history and marks an interrupted run failed after restart', async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'contact-run-state-'));
  const file = path.join(directory, 'runs.json');
  try {
    const run = createRun({ spreadsheetId: 'sheet-1', sheetName: 'Websites', dryRun: true });
    setRunStatus(run.runId, 'running');
    await saveRunState(file);
    clearJobState();
    await loadRunState(file);
    assert.equal(getRun(run.runId).status, 'failed');
    assert.equal(getRun(run.runId).error.code, 'SERVER_RESTARTED');
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test('only safely repeatable failed or manual-review results can be reset', () => {
  assert.equal(isSafeResultRetry({ status: 'failed', reason: 'Navigation timeout' }), true);
  assert.equal(isSafeResultRetry({ status: 'manual_review', reason: 'CAPTCHA detected' }), true);
  assert.equal(isSafeResultRetry({ status: 'success', reason: '' }), false);
  assert.equal(isSafeResultRetry({ status: 'failed', reason: 'Submission outcome uncertain' }), false);
  assert.equal(isSafeResultRetry({ status: 'failed', verificationEvidence: 'No reliable submission result' }), false);
});

test('Claude field mappings reject invented fields, keys, and duplicate selectors', () => {
  const options = { fieldIndexes: [0, 1], profileKeys: ['email', 'message'] };
  assert.deepEqual(validateFieldMapping({ mappings: [{ fieldIndex: 0, profileKey: 'email', confidence: 'high' }] }, options).mappings[0], { fieldIndex: 0, profileKey: 'email', confidence: 'high' });
  assert.throws(() => validateFieldMapping({ mappings: [{ fieldIndex: 9, profileKey: 'email', confidence: 'high' }] }, options), /Invalid field index/);
  assert.throws(() => validateFieldMapping({ mappings: [{ fieldIndex: 0, profileKey: 'invented', confidence: 'high' }] }, options), /Invalid profile key/);
  assert.throws(() => validateFieldMapping({ mappings: [{ fieldIndex: 0, profileKey: 'email', confidence: 'high' }, { fieldIndex: 0, profileKey: 'message', confidence: 'high' }] }, options), /Duplicate field index/);
});
