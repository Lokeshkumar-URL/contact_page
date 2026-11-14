import { randomUUID } from 'node:crypto';
import { EventEmitter } from 'node:events';

export const runs = new Map();
const activeSources = new Map();
const controls = new Map();
const activeStatuses = new Set(['queued', 'running', 'paused']);
const events = new EventEmitter(); events.setMaxListeners(1000); const sequences = new Map();

export class DuplicateRunError extends Error { constructor(runId) { super(`An active run already exists for this sheet: ${runId}`); this.name = 'DuplicateRunError'; this.runId = runId; } }

function sourceKey(config) { return `${config.spreadsheetId ?? 'configured-sheet'}::${config.sheetName ?? 'Websites'}`; }
function freshProgress() { return { total: 0, processed: 0, remaining: 0, success: 0, failed: 0, manualReview: 0, skipped: 0, currentBatch: 0 }; }
export function createRunEvent(run) { return { eventId: sequences.get(run.runId) ?? 0, runId: run.runId, status: run.status, progress: { ...run.progress }, error: run.error ? { ...run.error } : null, updatedAt: run.updatedAt, completedAt: run.completedAt ?? null }; }
function publish(run) { const eventId=(sequences.get(run.runId)??0)+1;sequences.set(run.runId,eventId);const event={...createRunEvent(run),eventId};events.emit(run.runId,event);events.emit('*',run); }
export function subscribeToRun(runId, listener) { events.on(runId,listener); return () => events.off(runId,listener); }
export function subscribeToAllRuns(listener){events.on('*',listener);return()=>events.off('*',listener);}
export function listRuns(){return [...runs.values()].sort((left,right)=>right.createdAt.localeCompare(left.createdAt));}

export function createRun(config = {}) {
  const key = sourceKey(config); const activeId = activeSources.get(key); const active = activeId && runs.get(activeId);
  if (active && activeStatuses.has(active.status)) throw new DuplicateRunError(active.runId);
  const now = new Date().toISOString(); const run = { runId: randomUUID(), sourceKey: key, status: 'queued', dryRun: config.dryRun !== false, configuration: config, progress: freshProgress(), results: [], createdAt: now, updatedAt: now, error: null };
  runs.set(run.runId, run); activeSources.set(key, run.runId); controls.set(run.runId, { abortController: new AbortController(), waiters: [] }); publish(run); return run;
}

export function getRun(runId) { return runs.get(runId); }
export function appendRunResult(runId, result) { const run=runs.get(runId);if(!run)return null;run.results=[...run.results,result];run.updatedAt=new Date().toISOString();publish(run);return result; }
export function removeRunResult(runId,rowNumber){const run=runs.get(runId);if(!run)return null;const result=run.results.find((item)=>item.rowNumber===rowNumber);if(!result)return null;run.results=run.results.filter((item)=>item!==result);const key=result.status==='manual_review'?'manualReview':result.status;run.progress={...run.progress,processed:Math.max(0,run.progress.processed-1),remaining:run.progress.remaining+1,[key]:Math.max(0,(run.progress[key]??0)-1)};run.updatedAt=new Date().toISOString();publish(run);return result;}
export const isActiveRun = (run) => activeStatuses.has(run?.status);
/** Removes a finished run and everything held in memory for it. Callers must refuse active runs first. */
export function deleteRun(runId) {
  const run = runs.get(runId); if (!run) return null;
  runs.delete(runId); controls.delete(runId); sequences.delete(runId);
  if (activeSources.get(run.sourceKey) === runId) activeSources.delete(run.sourceKey);
  events.emit('*', run); // lets run persistence save the new list
  return run;
}
/** Removes results from a run's activity and keeps its progress counters consistent. Returns the removed results. */
export function removeResults(runId, rowNumbers) {
  const run = runs.get(runId); if (!run) return [];
  const wanted = new Set(rowNumbers); const removed = run.results.filter((r) => wanted.has(r.rowNumber)); if (!removed.length) return [];
  const progress = { ...run.progress };
  for (const result of removed) {
    const key = result.status === 'manual_review' ? 'manualReview' : result.status;
    if (key in progress) progress[key] = Math.max(0, progress[key] - 1);
    progress.processed = Math.max(0, progress.processed - 1); progress.total = Math.max(0, progress.total - 1);
  }
  run.results = run.results.filter((r) => !wanted.has(r.rowNumber)); run.progress = progress; run.updatedAt = new Date().toISOString(); publish(run);
  return removed;
}
export function updateRun(runId, patch) { const run = runs.get(runId); if (!run) return null; Object.assign(run, patch, { updatedAt: new Date().toISOString() }); publish(run); return run; }
export function updateProgress(runId, patch) { const run = runs.get(runId); if (!run) return null; run.progress = { ...run.progress, ...patch }; run.updatedAt = new Date().toISOString(); publish(run); return run; }
export function setRunStatus(runId, status, patch = {}) {
  const run = updateRun(runId, { status, ...patch }); if (!run) return null;
  if (status !== 'paused') { const control = controls.get(runId); control?.waiters.splice(0).forEach((resolve) => resolve(status)); }
  if (!activeStatuses.has(status)) activeSources.delete(run.sourceKey);
  if (status === 'stopped') controls.get(runId)?.abortController.abort();
  return run;
}
export function getRunSignal(runId) { return controls.get(runId)?.abortController.signal; }
export async function waitUntilRunnable(runId) { const run = getRun(runId); if (!run || run.status === 'stopped') return false; if (run.status !== 'paused') return true; return new Promise((resolve) => controls.get(runId)?.waiters.push((status) => resolve(status !== 'stopped'))); }
export function restoreJobState(saved=[]){clearJobState();for(const entry of saved){const interrupted=activeStatuses.has(entry.status);const run={...entry,status:interrupted?'failed':entry.status,error:interrupted?{code:'SERVER_RESTARTED',message:'Run was interrupted by a backend restart.'}:entry.error,completedAt:interrupted?new Date().toISOString():entry.completedAt,results:Array.isArray(entry.results)?entry.results:[],progress:{...freshProgress(),...entry.progress}};runs.set(run.runId,run);controls.set(run.runId,{abortController:new AbortController(),waiters:[]});sequences.set(run.runId,0);}return listRuns();}
export function clearJobState() { runs.clear(); activeSources.clear(); controls.clear(); sequences.clear(); events.removeAllListeners(); }
