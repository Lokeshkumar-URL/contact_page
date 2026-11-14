import { mkdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const clean = (value) => String(value ?? 'unknown').replace(/[^a-zA-Z0-9_-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 80) || 'unknown';
export const SCREENSHOT_OUTCOMES = Object.freeze(['pre-submit', 'success', 'failed', 'dry-run', 'manual-review']);
export const SCREENSHOT_DIRECTORY = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../storage/screenshots');

export function normalizeScreenshotOutcome(value) {
  const normalized = String(value ?? '').trim().toLowerCase().replace(/[_\s]+/g, '-');
  return SCREENSHOT_OUTCOMES.includes(normalized) ? normalized : 'failed';
}

export async function captureScreenshot({ page, directory = SCREENSHOT_DIRECTORY, runId = 'standalone', rowNumber = 'row', stage = 'filled', fullPage = true, now = new Date() } = {}) {
  if (!page) throw new TypeError('A Puppeteer page is required.');
  const base = path.resolve(directory); await mkdir(base, { recursive: true });
  const outcome = normalizeScreenshotOutcome(stage);
  const filename = `${clean(runId)}-${clean(rowNumber)}-${outcome}-${now.toISOString().replace(/[:.]/g, '-')}.png`;
  const screenshotPath = path.resolve(base, filename);
  if (path.dirname(screenshotPath) !== base) throw new Error('Invalid screenshot path.');
  await page.screenshot({ path: screenshotPath, fullPage }); return screenshotPath;
}
