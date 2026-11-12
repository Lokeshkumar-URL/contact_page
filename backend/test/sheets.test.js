import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createGoogleAuth } from '../src/services/sheets/googleAuthService.js';
import { readPendingRows, readSheetRows } from '../src/services/sheets/sheetsReader.js';
import { recoverStaleRows, reserveRows, updateRowResult } from '../src/services/sheets/sheetsWriter.js';

const headers = ['URL', 'Status', 'Reason', 'Timestamp', 'Screenshot', 'Run ID', 'Attempt Count', 'Contact Page URL', 'Claude Used', 'Verification Evidence', 'Reserved At'];
const values = [
  headers,
  ['https://one.example', 'Pending', '', '', '', '', '0'],
  ['https://two.example', 'Success', '', '', '', 'old-run', '1'],
  ['https://three.example', '', '', '', '', '', '2'],
  ['https://stale.example', 'Processing', '', '', '', 'dead-run', '1', '', '', '', '2026-11-12T00:00:00.000Z'],
];

function createMockSheets({ sheetValues = values, verificationValues = [] } = {}) {
  const calls = { get: [], batchGet: [], batchUpdate: [] };
  return {
    calls,
    spreadsheets: { values: {
      get: async (input) => { calls.get.push(input); return { data: { values: sheetValues } }; },
      batchGet: async (input) => { calls.batchGet.push(input); return { data: { valueRanges: verificationValues.map((value) => ({ values: value === undefined ? [] : [[value]] })) } }; },
      batchUpdate: async (input) => { calls.batchUpdate.push(input); return { data: {} }; },
    } },
  };
}

test('service-account auth is configured without making a network request', () => {
  const auth = createGoogleAuth({ clientEmail: 'bot@example.iam.gserviceaccount.com', privateKey: '-----BEGIN PRIVATE KEY-----\\nabc\\n-----END PRIVATE KEY-----' });
  assert.equal(auth.scopes[0], 'https://www.googleapis.com/auth/spreadsheets');
  assert.throws(() => createGoogleAuth({}), /credentials are not configured/i);
});

test('reader validates headers and returns only pending URL rows', async () => {
  const sheets = createMockSheets();
  const result = await readPendingRows({ sheets, spreadsheetId: 'sheet-1', sheetName: "Client's Leads", limit: 10 });
  assert.deepEqual(result.rows.map((row) => row.url), ['https://one.example', 'https://three.example']);
  assert.equal(result.rows[1].attemptCount, 2);
  assert.match(sheets.calls.get[0].range, /'Client''s Leads'!A:ZZ/);
  const invalid = createMockSheets({ sheetValues: [['URL'], ['https://one.example']] });
  await assert.rejects(() => readSheetRows({ sheets: invalid, spreadsheetId: 'sheet-1' }), /missing required columns/i);
});

test('reservation rechecks status and run ID before marking rows Processing', async () => {
  const sheets = createMockSheets({ verificationValues: ['Pending', '', 'Success', 'other-run'] });
  const { columns, rows } = await readSheetRows({ sheets, spreadsheetId: 'sheet-1' });
  const pending = rows.filter((row) => row.rowNumber === 2 || row.rowNumber === 3);
  const reserved = await reserveRows({ sheets, spreadsheetId: 'sheet-1', columns, rows: pending, runId: 'run-123', now: new Date('2026-11-12T10:00:00.000Z') });
  assert.equal(reserved.length, 1); assert.equal(reserved[0].rowNumber, 2); assert.equal(reserved[0].attemptCount, 1);
  assert.equal(sheets.calls.batchUpdate.length, 1);
  const writes = sheets.calls.batchUpdate[0].requestBody.data;
  assert.ok(writes.some((entry) => entry.values[0][0] === 'Processing'));
  assert.ok(writes.some((entry) => entry.values[0][0] === 'run-123'));
});

test('result writer accepts only terminal statuses and clears reservation', async () => {
  const sheets = createMockSheets();
  const { columns } = await readSheetRows({ sheets, spreadsheetId: 'sheet-1' });
  await updateRowResult({ sheets, spreadsheetId: 'sheet-1', columns, rowNumber: 2, runId: 'run-123', result: { status: 'Success', screenshot: 'proof.png', contactPageUrl: 'https://one.example/contact', claudeUsed: true, verificationEvidence: 'Thank-you message' }, now: new Date('2026-11-12T11:00:00.000Z') });
  const writes = sheets.calls.batchUpdate.at(-1).requestBody.data;
  assert.ok(writes.some((entry) => entry.values[0][0] === 'Success'));
  assert.ok(writes.some((entry) => entry.values[0][0] === 'proof.png'));
  assert.ok(writes.some((entry) => entry.values[0][0] === 'Yes'));
  await assert.rejects(() => updateRowResult({ sheets, spreadsheetId: 'sheet-1', columns, rowNumber: 2, runId: 'run-123', result: { status: 'Processing' } }), /must be terminal/i);
});

test('stale Processing rows are recovered without changing active rows', async () => {
  const sheets = createMockSheets();
  const { columns, rows } = await readSheetRows({ sheets, spreadsheetId: 'sheet-1' });
  const recovered = await recoverStaleRows({ sheets, spreadsheetId: 'sheet-1', columns, rows, staleAfterMs: 60 * 60 * 1000, now: new Date('2026-11-12T10:00:00.000Z') });
  assert.deepEqual(recovered.map((row) => row.rowNumber), [5]);
  const writes = sheets.calls.batchUpdate.at(-1).requestBody.data;
  assert.ok(writes.some((entry) => entry.values[0][0] === 'Pending'));
  assert.ok(writes.some((entry) => entry.values[0][0] === 'Recovered after interrupted run'));
});
