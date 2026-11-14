import path from 'node:path'; import { isActiveRun, removeResults, runs } from '../services/automation/jobState.js'; import { removeScreenshotFiles } from '../services/automation/runCleanup.js'; import { assertCanDelete } from './automationController.js'; import { AppError } from '../errors/AppError.js';
import { retryRunResult } from '../services/automation/automationRuntime.js';
import { SCREENSHOT_DIRECTORY } from '../services/browser/screenshotService.js';
function requireRun(runId){const run=runs.get(runId);if(!run)throw new AppError(404,'RUN_NOT_FOUND','Automation run was not found.');return run;}
export function listResults(req,res){const run=requireRun(req.params.runId);res.json({runId:run.runId,status:run.status,error:run.error,updatedAt:run.updatedAt,results:run.results.map(({screenshot,...result})=>({...result,screenshot:screenshot?`/api/results/${encodeURIComponent(run.runId)}/screenshots/${encodeURIComponent(path.basename(screenshot))}`:''}))});}
export function getScreenshot(req,res){const run=requireRun(req.params.runId);const filename=path.basename(req.params.filename);const result=run.results.find((item)=>item.screenshot&&path.basename(item.screenshot)===filename);if(!result)throw new AppError(404,'SCREENSHOT_NOT_FOUND','Screenshot was not found for this run.');const absolute=path.resolve(result.screenshot);const root=path.resolve(SCREENSHOT_DIRECTORY);if(path.dirname(absolute)!==root)throw new AppError(403,'SCREENSHOT_PATH_BLOCKED','Screenshot path is not allowed.');res.sendFile(absolute);}
export async function retryResult(req,res,next){try{res.json(await retryRunResult(req.params.runId,Number(req.params.rowNumber)));}catch(error){if(error.code==='RUN_NOT_FOUND')return next(new AppError(404,error.code,error.message));if(error.code==='UNSAFE_RETRY')return next(new AppError(409,error.code,error.message));next(error);}}

async function deleteRows(req, res, next, rowNumbers) {
  try {
    const run = requireRun(req.params.runId); assertCanDelete(run, req.user);
    if (isActiveRun(run)) throw new AppError(409, 'RUN_ACTIVE', 'This run is still in progress. Stop it or wait for it to finish before deleting activity.');
    const removed = removeResults(run.runId, rowNumbers);
    if (!removed.length) throw new AppError(404, 'RESULT_NOT_FOUND', 'No matching submission activity was found.');
    await removeScreenshotFiles(removed);
    res.json({ deleted: removed.map((r) => r.rowNumber) });
  } catch (error) { next(error); }
}
export const deleteResult = (req, res, next) => deleteRows(req, res, next, [Number(req.params.rowNumber)]);
export const bulkDeleteResults = (req, res, next) => deleteRows(req, res, next, req.body.rowNumbers);
