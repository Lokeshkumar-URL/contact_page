import { unlink } from 'node:fs/promises';
import path from 'node:path';
import { SCREENSHOT_DIRECTORY } from '../browser/screenshotService.js';
import { runs } from './jobState.js';

/** Deletes screenshot files for removed results, unless another remaining result still points at the same file. */
export async function removeScreenshotFiles(removedResults) {
  const root = path.resolve(SCREENSHOT_DIRECTORY);
  const stillUsed = new Set([...runs.values()].flatMap((run) => run.results.map((r) => r.screenshot && path.resolve(r.screenshot)).filter(Boolean)));
  await Promise.all(removedResults.map(async (result) => {
    if (!result.screenshot) return;
    const file = path.resolve(result.screenshot);
    if (path.dirname(file) !== root || stillUsed.has(file)) return; // never touch files outside the screenshots folder
    try { await unlink(file); } catch { /* already gone */ }
  }));
}
