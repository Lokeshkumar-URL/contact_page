import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { SCREENSHOT_OUTCOMES, captureScreenshot, normalizeScreenshotOutcome } from '../src/services/browser/screenshotService.js';

test('all required screenshot outcomes use safe distinct filenames', async (t) => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'contact-screenshots-')); t.after(() => rm(directory, { recursive: true, force: true }));
  const paths = []; const page = { screenshot: async (options) => paths.push(options.path) };
  for (const stage of SCREENSHOT_OUTCOMES) {
    const saved = await captureScreenshot({ page, directory, runId: '../run 1', rowNumber: '../../2', stage, now: new Date('2026-11-12T12:00:00.000Z') });
    assert.equal(path.dirname(saved), directory); assert.match(path.basename(saved), new RegExp(`-${stage}-`));
  }
  assert.equal(new Set(paths).size, SCREENSHOT_OUTCOMES.length);
});

test('unknown outcomes are safely classified as failed', () => {
  assert.equal(normalizeScreenshotOutcome('Manual Review'), 'manual-review'); assert.equal(normalizeScreenshotOutcome('unexpected/value'), 'failed');
});
