/** Accepts a bare spreadsheet ID or a full Google Sheets URL and returns just the ID. */
export function extractSpreadsheetId(value) {
  const text = String(value ?? '').trim();
  return text.match(/\/spreadsheets\/d\/([a-zA-Z0-9_-]+)/)?.[1] ?? text;
}
