import assert from 'node:assert/strict';
import { afterEach, test } from 'node:test';
import { buildRunConfiguration, configureAutomationRuntimeForTests, getAutomationTask, launchAutomationRun, resetAutomationRuntimeForTests } from '../src/services/automation/automationRuntime.js';
import { clearJobState, createRun, getRun } from '../src/services/automation/jobState.js';

afterEach(() => { resetAutomationRuntimeForTests(); clearJobState(); });

test('runtime creates Sheets and Claude clients and starts the requested runner', async () => {
  const calls=[]; const run=createRun({spreadsheetId:'sheet-1',sheetName:'Websites',dryRun:true});
  configureAutomationRuntimeForTests({createSheetsClient:()=>{calls.push('sheets');return {kind:'sheets'};},createClaudeClient:()=>{calls.push('claude');return {kind:'claude'};},runAutomation:async(options)=>{calls.push('runner');assert.equal(options.runId,run.runId);assert.equal(options.sheets.kind,'sheets');assert.equal(options.processorOptions.claudeClient.kind,'claude');return getRun(run.runId);},logger:{error(){}}});
  const task=launchAutomationRun(run.runId); assert.equal(getAutomationTask(run.runId),task); await task; assert.deepEqual(calls,['sheets','claude','runner']); assert.equal(getAutomationTask(run.runId),undefined);
});

test('runtime startup failures are recorded on the run', async () => {
  const run=createRun({spreadsheetId:'sheet-1',sheetName:'Websites'}); configureAutomationRuntimeForTests({createSheetsClient:()=>{throw Object.assign(new Error('credentials missing'),{code:'GOOGLE_AUTH_FAILED'});},logger:{error(){}}});
  await launchAutomationRun(run.runId); assert.equal(getRun(run.runId).status,'failed'); assert.equal(getRun(run.runId).error.code,'GOOGLE_AUTH_FAILED');
});

test('API configuration is normalized with safe runtime defaults', () => {
  const config=buildRunConfiguration({spreadsheetId:'sheet-1',dryRun:true,contactProfile:{email:'person@example.com'}}); assert.equal(config.sheetName,'Websites'); assert.equal(config.batchSize,10); assert.equal(config.contactProfile.email,'person@example.com');
});
