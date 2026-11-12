import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { test } from 'node:test';
import { BrowserLifecycleError, BrowserManager, closeAllBrowsers } from '../src/services/browser/browserManager.js';

class FakePage extends EventEmitter {
  constructor() { super(); this.closed = false; }
  async setViewport(value) { this.viewport = value; }
  setDefaultNavigationTimeout(value) { this.navigationTimeout = value; }
  setDefaultTimeout(value) { this.actionTimeout = value; }
  async setUserAgent(value) { this.userAgent = value; }
  isClosed() { return this.closed; }
  async close() { if (!this.closed) { this.closed = true; this.emit('close'); } }
}

class FakeBrowser extends EventEmitter {
  constructor() { super(); this.connected = true; this.closeCalls = 0; }
  async newPage() { return new FakePage(); }
  async close() { this.closeCalls += 1; this.connected = false; this.emit('disconnected'); }
}

test('launches once and creates configured pages', async () => {
  const browser = new FakeBrowser(); let launches = 0;
  const manager = new BrowserManager({ puppeteerModule: { launch: async () => { launches += 1; return browser; } } });
  const page = await manager.createPage({ userAgent: 'Automation Test' }); await manager.launch();
  assert.equal(launches, 1); assert.equal(page.navigationTimeout, 45000); assert.equal(page.actionTimeout, 10000); assert.deepEqual(page.viewport, { width: 1440, height: 900 }); assert.equal(page.userAgent, 'Automation Test'); assert.equal(manager.status.pageCount, 1);
  await manager.close(); assert.equal(page.closed, true); assert.equal(browser.closeCalls, 1); assert.equal(manager.status.state, 'closed');
});

test('cleanup is idempotent and global cleanup closes active managers', async () => {
  const browser = new FakeBrowser(); const manager = new BrowserManager({ puppeteerModule: { launch: async () => browser } });
  await manager.launch(); await closeAllBrowsers(); await manager.close();
  assert.equal(browser.closeCalls, 1); assert.equal(manager.status.state, 'closed');
});

test('disconnects and page crashes update state without leaking pages', async () => {
  const browser = new FakeBrowser(); const manager = new BrowserManager({ puppeteerModule: { launch: async () => browser } });
  const page = await manager.createPage(); page.emit('error', new Error('renderer crash')); await new Promise((resolve) => setImmediate(resolve));
  assert.equal(manager.status.pageCount, 0); assert.equal(page.closed, true);
  browser.connected = false; browser.emit('disconnected'); assert.equal(manager.status.state, 'disconnected');
  await manager.close();
});

test('launch failures use a typed retryable lifecycle error', async () => {
  const manager = new BrowserManager({ puppeteerModule: { launch: async () => { throw new Error('Chrome missing'); } } });
  await assert.rejects(() => manager.launch(), (error) => error instanceof BrowserLifecycleError && error.code === 'BROWSER_LAUNCH_FAILED' && error.retryable === true);
});
