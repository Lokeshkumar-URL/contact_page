import { env } from '../../config/env.js';
import { SHEET_HEADERS, columnToLetter, escapeSheetName, isPendingStatus, isTerminalStatus, normalizeStatus } from './sheetSchema.js';

function cellRange(sheetName, columns, header, rowNumber) { const index = columns.get(header); if (index === undefined) return null; const letter = columnToLetter(index); return `${escapeSheetName(sheetName)}!${letter}${rowNumber}`; }
async function writeFields({ sheets, spreadsheetId, sheetName, columns, rowNumber, fields }) {
  const data = Object.entries(fields).map(([header, value]) => ({ range: cellRange(sheetName, columns, header, rowNumber), values: [[value ?? '']] })).filter((item) => item.range);
  if (!data.length) return;
  await sheets.spreadsheets.values.batchUpdate({ spreadsheetId, requestBody: { valueInputOption: 'RAW', data } });
}

export async function reserveRows({ sheets, spreadsheetId = env.googleSheetId, sheetName = env.googleSheetTab, columns, rows, runId, now = new Date() }) {
  if (!runId) throw new Error('Run ID is required to reserve rows.');
  const eligible = rows.filter((row) => row.url && isPendingStatus(row.status));
  if (!eligible.length) return [];
  const statusColumn = columnToLetter(columns.get(SHEET_HEADERS.status)); const runColumn = columnToLetter(columns.get(SHEET_HEADERS.runId));
  const ranges = eligible.flatMap((row) => [`${escapeSheetName(sheetName)}!${statusColumn}${row.rowNumber}`, `${escapeSheetName(sheetName)}!${runColumn}${row.rowNumber}`]);
  const current = await sheets.spreadsheets.values.batchGet({ spreadsheetId, ranges });
  const verified = eligible.filter((row, index) => {
    const status = current.data.valueRanges[index * 2]?.values?.[0]?.[0] ?? '';
    const existingRun = current.data.valueRanges[index * 2 + 1]?.values?.[0]?.[0] ?? '';
    return isPendingStatus(status) && !existingRun;
  });
  for (const row of verified) await writeFields({ sheets, spreadsheetId, sheetName, columns, rowNumber: row.rowNumber, fields: { [SHEET_HEADERS.status]: 'Processing', [SHEET_HEADERS.reason]: '', [SHEET_HEADERS.runId]: runId, [SHEET_HEADERS.attemptCount]: row.attemptCount + 1, [SHEET_HEADERS.reservedAt]: now.toISOString() } });
  return verified.map((row) => ({ ...row, status: 'Processing', runId, attemptCount: row.attemptCount + 1, reservedAt: now.toISOString() }));
}

export async function updateRowResult({ sheets, spreadsheetId = env.googleSheetId, sheetName = env.googleSheetTab, columns, rowNumber, runId, result, now = new Date() }) {
  if (!isTerminalStatus(result.status)) throw new Error(`Result status must be terminal; received ${result.status}.`);
  await writeFields({ sheets, spreadsheetId, sheetName, columns, rowNumber, fields: { [SHEET_HEADERS.status]: result.status, [SHEET_HEADERS.reason]: result.reason ?? '', [SHEET_HEADERS.timestamp]: now.toISOString(), [SHEET_HEADERS.screenshot]: result.screenshot ?? '', [SHEET_HEADERS.runId]: runId, [SHEET_HEADERS.contactPageUrl]: result.contactPageUrl ?? '', [SHEET_HEADERS.claudeUsed]: result.claudeUsed ? 'Yes' : 'No', [SHEET_HEADERS.verificationEvidence]: result.verificationEvidence ?? '', [SHEET_HEADERS.reservedAt]: '' } });
}

export async function recoverStaleRows({ sheets, spreadsheetId = env.googleSheetId, sheetName = env.googleSheetTab, columns, rows, staleAfterMs = 30 * 60 * 1000, now = new Date() }) {
  const stale = rows.filter((row) => normalizeStatus(row.status) === 'processing' && row.reservedAt && now.getTime() - new Date(row.reservedAt).getTime() >= staleAfterMs);
  for (const row of stale) await writeFields({ sheets, spreadsheetId, sheetName, columns, rowNumber: row.rowNumber, fields: { [SHEET_HEADERS.status]: 'Pending', [SHEET_HEADERS.reason]: 'Recovered after interrupted run', [SHEET_HEADERS.runId]: '', [SHEET_HEADERS.reservedAt]: '' } });
  return stale;
}

export async function releaseReservedRows({ sheets, spreadsheetId = env.googleSheetId, sheetName = env.googleSheetTab, columns, rows, runId, reason = 'Released by automation controller' }) {
  if (!rows.length) return [];
  const statusColumn = columnToLetter(columns.get(SHEET_HEADERS.status)); const runColumn = columnToLetter(columns.get(SHEET_HEADERS.runId));
  const ranges = rows.flatMap((row) => [`${escapeSheetName(sheetName)}!${statusColumn}${row.rowNumber}`, `${escapeSheetName(sheetName)}!${runColumn}${row.rowNumber}`]);
  const current = await sheets.spreadsheets.values.batchGet({ spreadsheetId, ranges });
  const owned = rows.filter((_row, index) => normalizeStatus(current.data.valueRanges[index * 2]?.values?.[0]?.[0]) === 'processing' && current.data.valueRanges[index * 2 + 1]?.values?.[0]?.[0] === runId);
  for (const row of owned) await writeFields({ sheets, spreadsheetId, sheetName, columns, rowNumber: row.rowNumber, fields: { [SHEET_HEADERS.status]: 'Pending', [SHEET_HEADERS.reason]: reason, [SHEET_HEADERS.runId]: '', [SHEET_HEADERS.reservedAt]: '' } });
  return owned;
}

export async function resetRowForRetry({sheets,spreadsheetId=env.googleSheetId,sheetName=env.googleSheetTab,columns,rowNumber}={}){if(!Number.isInteger(rowNumber)||rowNumber<2)throw new Error('A valid Sheet row number is required.');await writeFields({sheets,spreadsheetId,sheetName,columns,rowNumber,fields:{[SHEET_HEADERS.status]:'Pending',[SHEET_HEADERS.reason]:'',[SHEET_HEADERS.timestamp]:'',[SHEET_HEADERS.runId]:'',[SHEET_HEADERS.reservedAt]:''}});return {rowNumber,status:'Pending'};}
