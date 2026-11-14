export const SHEET_HEADERS = Object.freeze({
  url: 'URL', status: 'Status', reason: 'Reason', timestamp: 'Timestamp', screenshot: 'Screenshot',
  runId: 'Run ID', attemptCount: 'Attempt Count', contactPageUrl: 'Contact Page URL',
  claudeUsed: 'Claude Used', verificationEvidence: 'Verification Evidence', reservedAt: 'Reserved At', captcha: 'CAPTCHA',
});

export const REQUIRED_HEADERS = Object.freeze(['URL', 'Status', 'Reason', 'Timestamp', 'Run ID', 'Attempt Count', 'Reserved At']);
export const TERMINAL_STATUSES = new Set(['success', 'failed', 'manual review', 'skipped']);

export function normalizeStatus(value) { return String(value ?? '').trim().toLowerCase(); }
export function isPendingStatus(value) { const status = normalizeStatus(value); return status === '' || status === 'pending'; }
export function isTerminalStatus(value) { return TERMINAL_STATUSES.has(normalizeStatus(value)); }
export function escapeSheetName(name) { return `'${String(name).replaceAll("'", "''")}'`; }
export function columnToLetter(index) { let value = index + 1; let result = ''; while (value > 0) { const remainder = (value - 1) % 26; result = String.fromCharCode(65 + remainder) + result; value = Math.floor((value - 1) / 26); } return result; }

export function createColumnMap(headers) {
  const map = new Map(headers.map((header, index) => [String(header).trim(), index]));
  const missing = REQUIRED_HEADERS.filter((header) => !map.has(header));
  if (missing.length) throw new Error(`Google Sheet is missing required columns: ${missing.join(', ')}`);
  return map;
}

export function parseRows(values = []) {
  if (!values.length) throw new Error('Google Sheet is empty. Add the required header row.');
  const columns = createColumnMap(values[0]);
  const rows = values.slice(1).map((cells, index) => {
    const get = (header) => cells[columns.get(header)] ?? '';
    return { rowNumber: index + 2, url: String(get(SHEET_HEADERS.url)).trim(), status: get(SHEET_HEADERS.status), reason: get(SHEET_HEADERS.reason), timestamp: get(SHEET_HEADERS.timestamp), screenshot: get(SHEET_HEADERS.screenshot), runId: get(SHEET_HEADERS.runId), attemptCount: Number(get(SHEET_HEADERS.attemptCount)) || 0, contactPageUrl: get(SHEET_HEADERS.contactPageUrl), claudeUsed: get(SHEET_HEADERS.claudeUsed), verificationEvidence: get(SHEET_HEADERS.verificationEvidence), reservedAt: get(SHEET_HEADERS.reservedAt) };
  });
  return { columns, rows };
}
