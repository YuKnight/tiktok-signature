import { appendFileSync, mkdirSync, existsSync, readFileSync } from 'fs';
import { join } from 'path';
import { devices } from 'playwright-chromium';
import { config } from './config.js';
import logger from './logger.js';

const iPhone11 = devices["iPhone 11 Pro"];

class NetworkMonitor {
  constructor(browser, defaultUrl) {
    this.browser = browser;
    this.defaultUrl = defaultUrl || config.monitoring.defaultUrl;
    this.context = null;
    this.page = null;
    this.intervalId = null;
    this.lastItemListUrl = null; // Store the last captured item_list URL
    this.lastItemListCapturedAt = null; // Store when it was captured
    this.userAgent = config.browser.userAgent; // Store user agent
    this.waitingForCapture = false; // Flag for waiting state
    this.captureResolve = null; // Resolver for capture promise
  }

  async init() {
    logger.info('Initializing network monitor...');

    // Create context with same emulation as Signer
    const emulateTemplate = {
      ...iPhone11,
      locale: "en-US",
      deviceScaleFactor: 2,
      isMobile: true,
      hasTouch: true,
      userAgent: config.browser.userAgent,
    };
    emulateTemplate.viewport.width = 1920;
    emulateTemplate.viewport.height = 1080;

    this.context = await this.browser.newContext({
      bypassCSP: true,
      ...emulateTemplate,
    });

    this.page = await this.context.newPage();

    // Don't block scripts - we need the page to load normally to capture API requests
    // The monitoring page should behave like a real browser to trigger API calls

    this.setupRequestListener();
    logger.info(`Network monitor initialized - Browser connected: ${this.browser?.isConnected()}, Page closed: ${this.page?.isClosed()}`);
  }

  setupRequestListener() {
    this.page.on('request', (request) => {
      const url = request.url();

      // Filter for TikTok API endpoints
      if (url.includes('/api/')) {
        this.logApiRequest(request);
      }
    });
  }

  logApiRequest(request) {
    const url = request.url();
    const timestamp = new Date().toISOString();
    const logEntry = {
      timestamp: timestamp,
      method: request.method(),
      url: url
    };

    // Store last item_list URL if it matches the pattern
    if (url.includes('/api/post/item_list/')) {
      this.lastItemListUrl = url;
      this.lastItemListCapturedAt = timestamp;
      logger.info(`[API Capture - Item List] ${logEntry.method} ${url}`);

      // Resolve waiting promise if we're waiting for capture
      if (this.waitingForCapture && this.captureResolve) {
        logger.info('Item list captured, resolving wait promise');
        this.captureResolve();
        this.waitingForCapture = false;
        this.captureResolve = null;
      }
    } else {
      logger.info(`[API Capture] ${logEntry.method} ${url}`);
    }

    // File logging (append to logs/api_monitoring.log)
    this.appendToFile(logEntry);
  }

  appendToFile(logEntry) {
    try {
      const logDir = config.monitoring.logDir;
      const logPath = join(logDir, config.monitoring.logFile);

      // Ensure directory exists
      mkdirSync(logDir, { recursive: true });

      // Append as newline-delimited JSON
      const logLine = JSON.stringify(logEntry) + '\n';
      appendFileSync(logPath, logLine, 'utf8');
    } catch (error) {
      logger.error('Failed to write to log file', error);
    }
  }

  async ensurePageReady() {
    // Check if browser is still connected
    if (!this.browser || !this.browser.isConnected()) {
      logger.error('Browser is disconnected, cannot reinitialize without browser');
      throw new Error('Browser is disconnected');
    }

    // Check if context or page is closed
    if (!this.context || !this.page || this.page.isClosed()) {
      logger.info('Context or page is closed, reinitializing...');
      await this.init();
    }
  }

  async reloadAndCapture(skipRefresh = false) {
    try {
      logger.info('Reloading page for monitoring...');

      // Debug: log current state
      logger.info(`Browser connected: ${this.browser?.isConnected()}, Context: ${!!this.context}, Page: ${!!this.page}, Page closed: ${this.page?.isClosed()}`);

      // Ensure page is ready before attempting reload
      await this.ensurePageReady();

      logger.info('Page ready, proceeding with navigation...');

      // Set up promise to wait for item_list capture
      this.waitingForCapture = true;
      const capturePromise = new Promise((resolve) => {
        this.captureResolve = resolve;

        // Timeout after 15 seconds
        setTimeout(() => {
          if (this.waitingForCapture) {
            logger.info('Capture wait timeout after 15 seconds');
            this.waitingForCapture = false;
            this.captureResolve = null;
            resolve();
          }
        }, 15000);
      });

      // Load the page
      await this.page.goto(this.defaultUrl, {
        waitUntil: 'domcontentloaded',
        timeout: 30000
      });

      logger.info('Page loaded, waiting for item_list API call...');

      // Wait for either capture or 5 second minimum
      await Promise.all([
        new Promise(resolve => setTimeout(resolve, 5000)), // Wait at least 5 seconds
        capturePromise // Also wait for capture (or timeout)
      ]);

      // If still not captured after waiting, try scrolling to trigger lazy-loaded content
      if (!this.lastItemListUrl) {
        logger.info('Item list not captured yet, trying scroll to trigger API call...');
        try {
          await this.page.evaluate(() => {
            window.scrollTo(0, 500);
          });
          // Wait another 3 seconds after scroll
          await new Promise(resolve => setTimeout(resolve, 3000));
        } catch (scrollError) {
          logger.error('Error scrolling page', scrollError);
        }
      }

      // Always refresh once to ensure we get a fresh URL
      if (!skipRefresh) {
        logger.info('Refreshing page to get fresh item_list URL...');

        // Clear the waiting state before refresh
        this.waitingForCapture = false;
        this.captureResolve = null;

        // Refresh the page
        await this.page.reload({
          waitUntil: 'domcontentloaded',
          timeout: 30000
        });

        logger.info('Page refreshed, waiting for item_list API call...');

        // Set up new capture promise after refresh
        this.waitingForCapture = true;
        const refreshCapturePromise = new Promise((resolve) => {
          this.captureResolve = resolve;

          setTimeout(() => {
            if (this.waitingForCapture) {
              logger.info('Post-refresh capture timeout');
              this.waitingForCapture = false;
              this.captureResolve = null;
              resolve();
            }
          }, 15000);
        });

        // Wait again after refresh
        await Promise.all([
          new Promise(resolve => setTimeout(resolve, 5000)),
          refreshCapturePromise
        ]);
      }

      if (this.lastItemListUrl) {
        logger.info('Successfully captured item_list URL');
      } else {
        logger.warn('No item_list URL captured even after refresh');
      }

      logger.info('Page reload and capture complete');
    } catch (error) {
      logger.error('Failed to reload monitoring page', error);
      // Clean up promise state
      this.waitingForCapture = false;
      this.captureResolve = null;

      // If page/context was closed, try to reinitialize and retry once
      if (error.message && error.message.includes('closed')) {
        logger.info('Attempting to reinitialize after closed page error...');
        try {
          await this.init();
          logger.info('Reinitialized successfully, retrying capture...');
          await this.reloadAndCapture(true); // skipRefresh to avoid infinite loop
        } catch (retryError) {
          logger.error('Retry after reinitialize also failed', retryError);
        }
      }
    }
  }

  async start() {
    if (!config.monitoring.enabled) {
      logger.info('Network monitoring is disabled');
      return;
    }

    logger.info('Starting network monitoring...');
    await this.reloadAndCapture(); // Initial load

    // Set hourly interval
    this.intervalId = setInterval(() => {
      this.reloadAndCapture();
    }, config.monitoring.interval);

    logger.info(`Network monitoring started with ${config.monitoring.interval / 1000 / 60} minute interval`);
  }

  getLastItemListUrl() {
    return this.lastItemListUrl;
  }

  getLastItemListData() {
    // Always load from log file
    const logData = this.loadLastItemListFromLog();
    return {
      url: logData?.url || null,
      userAgent: this.userAgent,
      capturedAt: logData?.timestamp || null
    };
  }

  loadLastItemListFromLog() {
    try {
      const logPath = join(config.monitoring.logDir, config.monitoring.logFile);

      if (!existsSync(logPath)) {
        logger.info('Log file does not exist yet');
        return null;
      }

      const content = readFileSync(logPath, 'utf8');
      const lines = content.trim().split('\n').filter(line => line);

      // Search from the end to find the last item_list URL
      for (let i = lines.length - 1; i >= 0; i--) {
        try {
          const entry = JSON.parse(lines[i]);
          if (entry.url && entry.url.includes('/api/post/item_list/')) {
            logger.info(`Loaded last item_list URL from log file: ${entry.url}`);
            return entry;
          }
        } catch (parseError) {
          // Skip malformed lines
          continue;
        }
      }

      logger.info('No item_list URL found in log file');
      return null;
    } catch (error) {
      logger.error('Failed to read from log file', error);
      return null;
    }
  }

  async stop() {
    logger.info('Stopping network monitor...');

    if (this.intervalId) {
      clearInterval(this.intervalId);
      this.intervalId = null;
    }

    if (this.page) {
      try {
        await this.page.close();
      } catch (error) {
        logger.error('Error closing monitoring page', error);
      }
      this.page = null;
    }

    if (this.context) {
      try {
        await this.context.close();
      } catch (error) {
        logger.error('Error closing monitoring context', error);
      }
      this.context = null;
    }

    logger.info('Network monitor stopped');
  }
}

export default NetworkMonitor;
