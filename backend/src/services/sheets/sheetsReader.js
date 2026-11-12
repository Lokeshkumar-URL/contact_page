import { env } from '../../config/env.js';
import { escapeSheetName, isPendingStatus, parseRows } from './sheetSchema.js';

export async function readSheetRows({ sheets, spreadsheetId = env.googleSheetId, sheetName = env.googleSheetTab } = {}) {
  if (!sheets) throw new Error('A Google Sheets client is required.');
  if (!spreadsheetId) throw new Error('Google Sheet ID is not configured.');
  const response = await sheets.spreadsheets.values.get({ spreadsheetId, range: `${escapeSheetName(sheetName)}!A:ZZ` });
  return parseRows(response.data.values ?? []);
}

export async function readPendingRows(options = {}) {
  const { limit = env.batchSize } = options;
  const result = await readSheetRows(options);
  return { ...result, rows: result.rows.filter((row) => row.url && isPendingStatus(row.status)).slice(0, limit) };
}
