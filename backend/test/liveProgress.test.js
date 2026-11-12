import assert from 'node:assert/strict';
import { test } from 'node:test';
import { clearJobState, createRun, createRunEvent, setRunStatus, subscribeToRun, updateProgress } from '../src/services/automation/jobState.js';

test('run subscribers receive ordered progress and terminal snapshots', () => {
  clearJobState();const run=createRun({spreadsheetId:'sheet-1'});const received=[];const unsubscribe=subscribeToRun(run.runId,(event)=>received.push(event));
  updateProgress(run.runId,{total:3,remaining:2,processed:1,success:1});setRunStatus(run.runId,'completed',{completedAt:'2026-11-12T12:00:00.000Z'});unsubscribe();
  assert.equal(received.length,2);assert.ok(received[1].eventId>received[0].eventId);assert.equal(received[0].progress.success,1);assert.equal(received[1].status,'completed');assert.equal(received[1].completedAt,'2026-11-12T12:00:00.000Z');clearJobState();
});

test('public run events omit configuration and contact-profile data', () => {
  clearJobState();const run=createRun({spreadsheetId:'sheet-1',contactProfile:{email:'private@example.com'}});const event=createRunEvent(run);
  assert.equal(event.configuration,undefined);assert.equal(JSON.stringify(event).includes('private@example.com'),false);assert.deepEqual(Object.keys(event.progress),['total','processed','remaining','success','failed','manualReview','skipped','currentBatch']);clearJobState();
});
