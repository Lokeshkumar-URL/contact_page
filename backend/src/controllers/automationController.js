import { AppError } from '../errors/AppError.js';
import { DuplicateRunError, createRun, deleteRun, isActiveRun, createRunEvent, getRun, listRuns, setRunStatus, subscribeToRun } from '../services/automation/jobState.js';
import { removeScreenshotFiles } from '../services/automation/runCleanup.js';
import { buildRunConfiguration, launchAutomationRun, resolveRunCredentials } from '../services/automation/automationRuntime.js';

export async function start(request, response, next) {
  try {
    const config = buildRunConfiguration(request.body);
    // Remember who started the run so their saved Google account can be opened later, and fail early if it is not theirs.
    if (config.googleAccountId) { config.googleOwnerId = request.user?.id; await resolveRunCredentials(config); }
    const run=createRun(config); run.startedBy = request.user?.id; response.status(202).json(run); launchAutomationRun(run.runId);
  }
  catch (error) { if (error instanceof DuplicateRunError) return next(new AppError(409, 'DUPLICATE_RUN', error.message, { runId: error.runId })); next(error); }
}
function requireRun(runId) { const run = getRun(runId); if (!run) throw new AppError(404, 'RUN_NOT_FOUND', 'Automation run was not found.'); return run; }
function transition(request, response, allowed, status) { const run = requireRun(request.params.runId); if (!allowed.includes(run.status)) throw new AppError(409, 'INVALID_RUN_STATE', `Cannot change a ${run.status} run to ${status}.`); response.json(setRunStatus(run.runId, status)); }
export function pause(request, response) { transition(request, response, ['queued', 'running'], 'paused'); }
export function resume(request, response) { transition(request, response, ['paused'], 'queued'); }
export function stop(request, response) { transition(request, response, ['queued', 'running', 'paused'], 'stopped'); }
export function getRunStatus(request, response) { response.json(requireRun(request.params.runId)); }
export function getRunHistory(_request,response){response.json({runs:listRuns().map(({configuration,results,...run})=>({...run,resultCount:results.length,dryRun:configuration?.dryRun!==false}))});}
export function streamRunEvents(request, response) {
  const run=requireRun(request.params.runId);response.status(200);response.set({ 'Content-Type':'text/event-stream','Cache-Control':'no-cache, no-transform','Connection':'keep-alive','X-Accel-Buffering':'no' });response.flushHeaders?.();
  let closed=false;const terminal=new Set(['completed','failed','stopped']);const send=(event)=>{if(closed)return;response.write(`id: ${event.eventId}\ndata: ${JSON.stringify(event)}\n\n`);if(terminal.has(event.status)){closed=true;cleanup();response.end();}};
  const unsubscribe=subscribeToRun(run.runId,send);const heartbeat=setInterval(()=>{if(!closed)response.write(': heartbeat\n\n');},15000);heartbeat.unref?.();
  const cleanup=()=>{clearInterval(heartbeat);unsubscribe();};request.on('close',()=>{if(!closed){closed=true;cleanup();}});send(createRunEvent(run));
}

// Admins (and the API token) can delete any run; everyone else only the ones they started.
export function assertCanDelete(run, user) {
  if (user?.role === 'admin' || user?.role === 'service' || (run.startedBy && run.startedBy === user?.id)) return;
  throw new AppError(403, 'FORBIDDEN', 'You can only delete runs that you started.');
}
async function removeOne(run, user) {
  assertCanDelete(run, user);
  if (isActiveRun(run)) throw new AppError(409, 'RUN_ACTIVE', 'This run is still in progress. Stop it before deleting.');
  deleteRun(run.runId); await removeScreenshotFiles(run.results);
}
export async function remove(request, response, next) { try { await removeOne(requireRun(request.params.runId), request.user); response.status(204).end(); } catch (error) { next(error); } }
export async function bulkRemove(request, response, next) {
  try {
    const deleted = []; const skipped = [];
    for (const runId of new Set(request.body.runIds)) {
      const run = getRun(runId);
      try { if (!run) throw new AppError(404, 'RUN_NOT_FOUND', 'Run not found.'); await removeOne(run, request.user); deleted.push(runId); }
      catch (error) { skipped.push({ runId, reason: error.message }); }
    }
    response.json({ deleted, skipped });
  } catch (error) { next(error); }
}
