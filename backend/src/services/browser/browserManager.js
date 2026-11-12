import puppeteer from 'puppeteer';

const activeManagers = new Set();
const noopLogger = { info() {}, warn() {}, error() {} };

export class BrowserLifecycleError extends Error {
  constructor(message, { code = 'BROWSER_LIFECYCLE_ERROR', cause } = {}) {
    super(message, { cause }); this.name = 'BrowserLifecycleError'; this.code = code; this.stage = 'browser'; this.retryable = code === 'BROWSER_LAUNCH_FAILED';
  }
}

export class BrowserManager {
  constructor({ puppeteerModule = puppeteer, headless = true, navigationTimeout = 45000, actionTimeout = 10000, viewport = { width: 1440, height: 900 }, launchOptions = {}, logger = noopLogger } = {}) {
    this.puppeteer = puppeteerModule; this.options = { headless, navigationTimeout, actionTimeout, viewport, launchOptions }; this.logger = logger;
    this.browser = null; this.pages = new Set(); this.state = 'idle'; this.launchPromise = null; this.closePromise = null;
  }

  async launch() {
    if (this.state === 'ready' && this.browser?.connected !== false) return this.browser;
    if (this.launchPromise) return this.launchPromise;
    if (this.state === 'closing' || this.state === 'closed') throw new BrowserLifecycleError('A closed browser manager cannot be launched again.', { code: 'BROWSER_CLOSED' });
    this.state = 'launching';
    this.launchPromise = (async () => {
      try {
        this.browser = await this.puppeteer.launch({ headless: this.options.headless, args: ['--disable-dev-shm-usage'], ...this.options.launchOptions });
        this.browser.once?.('disconnected', () => this.handleDisconnected());
        this.state = 'ready'; activeManagers.add(this); this.logger.info('Puppeteer browser launched', { headless: this.options.headless }); return this.browser;
      } catch (cause) { this.state = 'failed'; throw new BrowserLifecycleError('Puppeteer could not launch Chrome.', { code: 'BROWSER_LAUNCH_FAILED', cause }); }
      finally { this.launchPromise = null; }
    })();
    return this.launchPromise;
  }

  async createPage({ viewport = this.options.viewport, navigationTimeout = this.options.navigationTimeout, actionTimeout = this.options.actionTimeout, userAgent } = {}) {
    if (this.state !== 'ready') await this.launch();
    try {
      const page = await this.browser.newPage(); this.pages.add(page);
      if (viewport) await page.setViewport(viewport);
      page.setDefaultNavigationTimeout(navigationTimeout); page.setDefaultTimeout(actionTimeout);
      if (userAgent) await page.setUserAgent(userAgent);
      page.once?.('close', () => this.pages.delete(page));
      page.once?.('error', (error) => { this.logger.error('Puppeteer page crashed', { error }); this.pages.delete(page); void this.safeClosePage(page); });
      return page;
    } catch (cause) { throw new BrowserLifecycleError('Puppeteer could not create a page.', { code: 'PAGE_CREATE_FAILED', cause }); }
  }

  async safeClosePage(page) {
    if (!page) return; this.pages.delete(page);
    try { if (!page.isClosed?.()) await page.close(); } catch (error) { this.logger.warn('Puppeteer page cleanup failed', { error }); }
  }

  handleDisconnected() {
    this.pages.clear();
    if (!['closing', 'closed'].includes(this.state)) this.state = 'disconnected';
  }

  async close() {
    if (this.closePromise) return this.closePromise;
    if (this.state === 'closed') return;
    this.state = 'closing';
    this.closePromise = (async () => {
      await Promise.allSettled([...this.pages].map((page) => this.safeClosePage(page)));
      try { if (this.browser?.connected !== false) await this.browser?.close?.(); } catch (error) { this.logger.warn('Puppeteer browser cleanup failed', { error }); }
      finally { this.pages.clear(); this.browser = null; this.state = 'closed'; activeManagers.delete(this); this.logger.info('Puppeteer browser closed'); }
    })();
    return this.closePromise;
  }

  get status() { return { state: this.state, pageCount: this.pages.size, connected: Boolean(this.browser && this.browser.connected !== false) }; }
}

export async function createBrowser(options = {}) { const manager = new BrowserManager(options); await manager.launch(); return manager; }
export async function closeAllBrowsers() { await Promise.allSettled([...activeManagers].map((manager) => manager.close())); }
