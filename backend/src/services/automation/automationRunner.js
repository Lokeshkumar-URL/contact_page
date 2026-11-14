import { readPendingRows, readSheetRows } from '../sheets/sheetsReader.js';
import { recoverStaleRows, releaseReservedRows, reserveRows, updateRowResult } from '../sheets/sheetsWriter.js';
import { processBatch } from './batchProcessor.js';
import { appendRunResult, getRun, getRunSignal, setRunStatus, updateProgress, waitUntilRunnable } from './jobState.js';
import { executeWithRetry, retryPolicy } from './retryPolicy.js';
import { processWebsite as defaultProcessor } from './websiteProcessor.js';

function failureResult(error) { const reviewCodes=error?.reasons?.map((reason)=>reason.code).filter(Boolean)??[]; return { status: error?.code === 'MANUAL_REVIEW' ? 'Manual Review' : error?.code === 'CAPTCHA_BLOCKED' ? 'Skipped' : 'Failed', reason: error?.message ?? 'Unknown processing error', screenshot: error?.screenshot ?? '', contactPageUrl: error?.contactPageUrl ?? '', claudeUsed: error?.claudeUsed === true, verificationEvidence: reviewCodes.length?reviewCodes.join(', '):error?.code ?? 'PROCESSING_ERROR', captcha: error?.captcha ?? '', captchaType: error?.captchaType ?? '' }; }
function progressPatch(progress, result) { const status = String(result.status).toLowerCase(); const key = status === 'success' ? 'success' : status === 'manual review' ? 'manualReview' : status === 'skipped' ? 'skipped' : 'failed'; return { processed: progress.processed + 1, remaining: Math.max(0, progress.remaining - 1), [key]: progress[key] + 1 }; }

export async function runAutomation({ runId, sheets, processWebsite = defaultProcessor, processorOptions = {}, policy = retryPolicy, staleAfterMs } = {}) {
  const run = getRun(runId); if (!run) throw new Error(`Run ${runId} does not exist.`);
  const config = run.configuration; const sheetOptions = { sheets, spreadsheetId: config.spreadsheetId, sheetName: config.sheetName };
  try {
    setRunStatus(runId, 'running');
    let snapshot = await readSheetRows(sheetOptions); await recoverStaleRows({ ...sheetOptions, ...snapshot, staleAfterMs }); snapshot = await readSheetRows(sheetOptions);
    const eligible = snapshot.rows.filter((row) => row.url && (!row.status || String(row.status).toLowerCase() === 'pending'));
    updateProgress(runId, { total: eligible.length, remaining: eligible.length });
    let batchNumber = 0;
    while (await waitUntilRunnable(runId)) {
      if (getRunSignal(runId)?.aborted) break;
      const pending = await readPendingRows({ ...sheetOptions, limit: Math.min(config.batchSize ?? 10, 10) });
      if (!pending.rows.length) break;
      const reserved = await reserveRows({ ...sheetOptions, columns: pending.columns, rows: pending.rows, runId });
      if (!reserved.length) continue;
      batchNumber += 1; updateProgress(runId, { currentBatch: batchNumber });
      const batch = await processBatch({ items: reserved, concurrency: Math.min(config.concurrency ?? 3, 10), beforeEach: () => waitUntilRunnable(runId), processor: (row) => executeWithRetry((attempt) => processWebsite(row, { ...processorOptions, runId, config, profile: config.contactProfile ?? processorOptions.profile ?? {}, attempt, signal: getRunSignal(runId) }), policy) });
      for (const entry of batch.completed) {
        const result = entry.error ? failureResult(entry.error) : entry.value;
        await updateRowResult({ ...sheetOptions, columns: pending.columns, rowNumber: entry.item.rowNumber, runId, result });
        appendRunResult(runId, { id: String(entry.item.rowNumber), rowNumber: entry.item.rowNumber, url: entry.item.url, contactPageUrl: result.contactPageUrl ?? '', status: String(result.status).toLowerCase().replace(/\s+/g, '_'), reason: result.reason ?? '', attemptCount: entry.item.attemptCount, timestamp: new Date().toISOString(), runId, screenshot: result.screenshot ?? '', claudeUsed: result.claudeUsed === true, verificationEvidence: result.verificationEvidence ?? '', captcha: result.captcha ?? '', captchaType: result.captchaType ?? '' });
        updateProgress(runId, progressPatch(getRun(runId).progress, result));
      }
      if (batch.unprocessed.length) await releaseReservedRows({ ...sheetOptions, columns: pending.columns, rows: batch.unprocessed, runId, reason: 'Run stopped before processing' });
      if (getRunSignal(runId)?.aborted) break;
    }
    const latest = getRun(runId); if (latest.status !== 'stopped') setRunStatus(runId, 'completed', { completedAt: new Date().toISOString() }); return getRun(runId);
  } catch (error) { setRunStatus(runId, 'failed', { error: { message: error.message, code: error.code ?? 'RUN_FAILED' }, completedAt: new Date().toISOString() }); throw error; }
}
