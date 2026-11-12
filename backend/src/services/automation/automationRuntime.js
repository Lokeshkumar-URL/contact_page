import { env } from '../../config/env.js';
import { logger } from '../../utils/logger.js';
import { createClaudeClient } from '../claude/claudeClient.js';
import { ClaudeUsageTracker } from '../claude/claudeUsageTracker.js';
import { createSheetsClient } from '../sheets/googleAuthService.js';
import { runAutomation } from './automationRunner.js';
import { getRun, setRunStatus } from './jobState.js';
import { removeRunResult } from './jobState.js';
import { readSheetRows } from '../sheets/sheetsReader.js';
import { resetRowForRetry } from '../sheets/sheetsWriter.js';

const tasks = new Map();
let dependencies = { createSheetsClient, createClaudeClient, runAutomation, logger };

export function buildRunConfiguration(body = {}) {
  return { spreadsheetId: body.spreadsheetId ?? env.googleSheetId, sheetName: body.sheetName ?? env.googleSheetTab, batchSize: body.batchSize ?? env.batchSize, concurrency: body.concurrency ?? 3, timeoutSeconds: body.timeoutSeconds ?? 45, browserMode: body.browserMode ?? (env.headless ? 'headless' : 'visible'), dryRun: body.dryRun !== false, liveConfirmed: body.liveConfirmed === true, contactProfile: body.contactProfile ?? {} };
}

export function launchAutomationRun(runId) {
  if (tasks.has(runId)) return tasks.get(runId);
  const task = Promise.resolve().then(async () => {
    const sheets = dependencies.createSheetsClient(); const claudeClient = dependencies.createClaudeClient(); const claudeTracker = new ClaudeUsageTracker();
    return dependencies.runAutomation({ runId, sheets, processorOptions: { claudeClient, claudeModel: env.claudeModel, claudeTracker } });
  }).catch((error) => {
    const run = getRun(runId); if (run && !['failed','stopped'].includes(run.status)) setRunStatus(runId, 'failed', { error: { code: error.code ?? 'RUN_START_FAILED', message: error.message }, completedAt: new Date().toISOString() });
    dependencies.logger.error('Automation run failed', { runId, error }); return getRun(runId);
  }).finally(() => tasks.delete(runId));
  tasks.set(runId, task); return task;
}

export function getAutomationTask(runId) { return tasks.get(runId); }
export function isSafeResultRetry(result){if(!result||!['failed','manual_review'].includes(result.status))return false;return !/uncertain|already started|duplicate|no reliable submission result|did not provide reliable success/i.test(`${result.reason} ${result.verificationEvidence}`);}
export async function retryRunResult(runId,rowNumber){const run=getRun(runId);if(!run)throw Object.assign(new Error('Automation run was not found.'),{code:'RUN_NOT_FOUND'});const result=run.results.find((item)=>item.rowNumber===rowNumber);if(!isSafeResultRetry(result))throw Object.assign(new Error('This result cannot be retried safely.'),{code:'UNSAFE_RETRY'});const sheets=dependencies.createSheetsClient();const sheet=await readSheetRows({sheets,spreadsheetId:run.configuration.spreadsheetId,sheetName:run.configuration.sheetName});await resetRowForRetry({sheets,spreadsheetId:run.configuration.spreadsheetId,sheetName:run.configuration.sheetName,columns:sheet.columns,rowNumber});removeRunResult(runId,rowNumber);return {runId,rowNumber,status:'Pending'};}
export function configureAutomationRuntimeForTests(overrides = {}) { dependencies = { ...dependencies, ...overrides }; }
export function resetAutomationRuntimeForTests() { dependencies = { createSheetsClient, createClaudeClient, runAutomation, logger }; tasks.clear(); }
