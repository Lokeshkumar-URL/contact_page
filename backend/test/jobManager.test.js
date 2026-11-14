import assert from 'node:assert/strict';
import { afterEach, test } from 'node:test';
import { processBatch } from '../src/services/automation/batchProcessor.js';
import { clearJobState, createRun, getRun, setRunStatus } from '../src/services/automation/jobState.js';
import { executeWithRetry, isSafeToRetry } from '../src/services/automation/retryPolicy.js';
import { runAutomation } from '../src/services/automation/automationRunner.js';

afterEach(() => clearJobState());

function createMutableSheets(urls) {
  const headers = ['URL','Status','Reason','Timestamp','Screenshot','Run ID','Attempt Count','Contact Page URL','Claude Used','Verification Evidence','Reserved At'];
  const matrix = [headers, ...urls.map((url) => [url,'Pending','','','','','0','','','',''])];
  const columnIndex = (letters) => [...letters].reduce((value, letter) => value * 26 + letter.charCodeAt(0) - 64, 0) - 1;
  const cell = (range) => { const match = range.match(/!([A-Z]+)(\d+)$/); return { column: columnIndex(match[1]), row: Number(match[2]) - 1 }; };
  return { matrix, spreadsheets: { values: {
    get: async () => ({ data: { values: matrix.map((row) => [...row]) } }),
    batchGet: async ({ ranges }) => ({ data: { valueRanges: ranges.map((range) => { const position = cell(range); return { values: [[matrix[position.row]?.[position.column] ?? '']] }; }) } }),
    batchUpdate: async ({ requestBody }) => { for (const entry of requestBody.data) { const position = cell(entry.range); matrix[position.row][position.column] = entry.values[0][0]; } return { data: {} }; },
  } } };
}

test('duplicate starts are rejected until the active run reaches a terminal state', () => {
  const first = createRun({ spreadsheetId: 'sheet-1', sheetName: 'Websites' });
  assert.throws(() => createRun({ spreadsheetId: 'sheet-1', sheetName: 'Websites' }), /active run already exists/i);
  setRunStatus(first.runId, 'stopped');
  assert.doesNotThrow(() => createRun({ spreadsheetId: 'sheet-1', sheetName: 'Websites' }));
});

test('batch processor respects concurrency and returns unprocessed work when halted', async () => {
  let active = 0; let peak = 0;
  const result = await processBatch({ items: [1,2,3,4,5], concurrency: 2, processor: async (item) => { active += 1; peak = Math.max(peak, active); await new Promise((resolve) => setTimeout(resolve, 5)); active -= 1; return item * 2; } });
  assert.equal(peak, 2); assert.equal(result.completed.length, 5); assert.equal(result.unprocessed.length, 0);
  const halted = await processBatch({ items: [1,2,3], concurrency: 1, beforeEach: async () => false, processor: async (item) => item });
  assert.equal(halted.completed.length, 0); assert.deepEqual(halted.unprocessed, [1,2,3]);
});

test('retry policy retries navigation once but never retries after submission starts', async () => {
  let calls = 0;
  const value = await executeWithRetry(async () => { calls += 1; if (calls === 1) throw Object.assign(new Error('temporary'), { retryable: true, stage: 'navigation' }); return 'ok'; }, undefined, async () => {});
  assert.equal(value, 'ok'); assert.equal(calls, 2);
  assert.equal(isSafeToRetry({ retryable: true, stage: 'navigation', submissionStarted: true }, 1), false);
  assert.equal(isSafeToRetry({ retryable: true, stage: 'submission' }, 1), false);
});

test('automation runner processes batches, tracks progress, and completes rows once', async () => {
  const sheets = createMutableSheets(['https://one.example','https://two.example','https://three.example']);
  const run = createRun({ spreadsheetId: 'sheet-1', sheetName: 'Websites', batchSize: 10, concurrency: 2, dryRun: true });
  const attempts = new Map();
  const completed = await runAutomation({ runId: run.runId, sheets, processWebsite: async (row) => { attempts.set(row.url, (attempts.get(row.url) ?? 0) + 1); return { status: 'Success', reason: '', verificationEvidence: 'Dry-run completed' }; } });
  assert.equal(completed.status, 'completed');
  assert.equal(completed.results.length, 3); assert.ok(completed.results.every((result) => result.status === 'success' && result.runId === run.runId));
  assert.deepEqual(completed.progress, { total: 3, processed: 3, remaining: 0, success: 3, failed: 0, manualReview: 0, skipped: 0, currentBatch: 1 });
  assert.equal(attempts.size, 3); assert.ok([...attempts.values()].every((count) => count === 1));
  assert.ok(sheets.matrix.slice(1).every((row) => row[1] === 'Success'));
});

test('confirmed live runner processes the full batch with configured concurrency', async () => {
  const sheets = createMutableSheets(['https://one.example','https://two.example','https://three.example']);
  const run = createRun({ spreadsheetId: 'sheet-1', sheetName: 'Websites', batchSize: 3, concurrency: 2, dryRun: false, liveConfirmed: true });
  let active=0;let peak=0;
  const completed = await runAutomation({ runId: run.runId, sheets, processWebsite: async () => { active+=1;peak=Math.max(peak,active);await new Promise((resolve)=>setTimeout(resolve,5));active-=1;return { status:'Success', verificationEvidence:'Thank you' }; } });
  assert.equal(completed.results.length,3);assert.equal(peak,2);assert.ok(sheets.matrix.slice(1).every((row)=>row[1]==='Success'));
});

test('stopping a run prevents new work and releases reserved rows', async () => {
  const sheets = createMutableSheets(['https://one.example','https://two.example','https://three.example']);
  const run = createRun({ spreadsheetId: 'sheet-1', sheetName: 'Websites', batchSize: 10, concurrency: 1, dryRun: true });
  let processed = 0;
  const stopped = await runAutomation({ runId: run.runId, sheets, processWebsite: async () => { processed += 1; setRunStatus(run.runId, 'stopped'); return { status: 'Success' }; } });
  assert.equal(stopped.status, 'stopped'); assert.equal(processed, 1); assert.equal(getRun(run.runId).progress.processed, 1);
  assert.equal(sheets.matrix[1][1], 'Success'); assert.equal(sheets.matrix[2][1], 'Pending'); assert.equal(sheets.matrix[3][1], 'Pending');
});
