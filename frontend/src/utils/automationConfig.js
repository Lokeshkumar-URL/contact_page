export const DEFAULT_AUTOMATION_CONFIG = Object.freeze({
  spreadsheetId: '',
  sheetName: 'Sheet1',
  batchSize: 10,
  concurrency: 3,
  timeoutSeconds: 45,
  browserMode: 'visible',
  dryRun: true,
});

const numericRules = {
  batchSize: { min: 1, max: 10, label: 'Batch size' },
  concurrency: { min: 1, max: 10, label: 'Concurrency' },
  timeoutSeconds: { min: 10, max: 120, label: 'Page timeout' },
};

export function validateAutomationConfig(config) {
  const errors = {};

  if (!config.spreadsheetId?.trim()) errors.spreadsheetId = 'Google Sheet ID is required.';
  if (!config.sheetName?.trim()) errors.sheetName = 'Sheet tab name is required.';

  for (const [field, { min, max, label }] of Object.entries(numericRules)) {
    const value = Number(config[field]);
    if (!Number.isInteger(value) || value < min || value > max) {
      errors[field] = `${label} must be a whole number from ${min} to ${max}.`;
    }
  }

  if (!['visible', 'headless'].includes(config.browserMode)) {
    errors.browserMode = 'Choose a supported browser mode.';
  }

  return errors;
}

export function normalizeAutomationConfig(config) {
  return {
    ...config,
    spreadsheetId: config.spreadsheetId.trim(),
    sheetName: config.sheetName.trim(),
    batchSize: Number(config.batchSize),
    concurrency: Number(config.concurrency),
    timeoutSeconds: Number(config.timeoutSeconds),
    dryRun: Boolean(config.dryRun),
  };
}
