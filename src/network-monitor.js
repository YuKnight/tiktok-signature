import { appendFileSync, mkdirSync } from 'fs';
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
    this.userAgent = config.browser.userAgent; // Store user agent
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
    logger.info('Network monitor initialized');
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
    const logEntry = {
      timestamp: new Date().toISOString(),
      method: request.method(),
      url: url
    };

    // Store last item_list URL if it matches the pattern
    if (url.includes('/api/post/item_list/')) {
      this.lastItemListUrl = url;
      logger.info(`[API Capture - Item List] ${logEntry.method} ${url}`);
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

  async reloadAndCapture() {
    try {
      logger.info('Reloading page for monitoring...');
      await this.page.goto(this.defaultUrl, {
        waitUntil: 'networkidle',
        timeout: 30000
      });
      logger.info('Page reloaded for monitoring');
    } catch (error) {
      logger.error('Failed to reload monitoring page', error);
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
    return {
      url: this.lastItemListUrl,
      userAgent: this.userAgent
    };
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
