import "dotenv/config";
import { createCipheriv, createHash } from "crypto";
import { devices, chromium } from "playwright-chromium";
import { fileURLToPath } from "url";
import { dirname } from "path";
import Utils from "./utils.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const iPhone15 = devices["Desktop Safari"];

// Proxy URL from environment variable
const PROXY_URL = process.env.PROXY_URL || null;

class Signer {
  userAgent =
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_6) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/98.0.4758.109 Safari/537.36";
  args = [
    "--disable-blink-features",
    "--disable-blink-features=AutomationControlled",
    "--disable-infobars",
    "--window-size=1920,1080",
    "--start-maximized",
  ];
  // Default TikTok loading page
  default_url = "https://www.tiktok.com/@andreibanuta";

  // Password for xttparams AES encryption
  password = "webapp1.0+202106";

  // Additional properties
  deviceId = Utils.generateDeviceId();

  constructor(default_url, userAgent, browser) {
    if (default_url) {
      this.default_url = default_url;
    }
    if (userAgent) {
      this.userAgent = userAgent;
    }

    if (browser) {
      this.browser = browser;
      this.isExternalBrowser = true;
    }

    this.args.push(`--user-agent="${this.userAgent}"`);

    this.options = {
      headless: true,
      args: this.args,
      ignoreDefaultArgs: ["--mute-audio", "--hide-scrollbars"],
      ignoreHTTPSErrors: true,
    };

    // Add executablePath if configured via EXECUTABLE_PATH env variable
    // Example: EXECUTABLE_PATH="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
    if (process.env.EXECUTABLE_PATH) {
      this.options.executablePath = process.env.EXECUTABLE_PATH;
      console.log(`Using Chrome executable: ${process.env.EXECUTABLE_PATH}`);
    }

    // Add proxy if configured via PROXY_URL env variable
    if (PROXY_URL) {
      try {
        const proxyUrl = new URL(PROXY_URL);
        this.options.proxy = {
          server: `${proxyUrl.protocol}//${proxyUrl.host}`
        };
        // Add credentials if present
        if (proxyUrl.username && proxyUrl.password) {
          this.options.proxy.username = decodeURIComponent(proxyUrl.username);
          this.options.proxy.password = decodeURIComponent(proxyUrl.password);
        }
        console.log(`Using proxy: ${proxyUrl.protocol}//${proxyUrl.host}`);
      } catch (e) {
        console.error("Invalid PROXY_URL format:", e.message);
      }
    }
  }

  async init() {
    // Close existing browser if it exists
    if (this.browser && !this.isExternalBrowser) {
      try {
        await this.browser.close();
      } catch (e) {
        console.log("Error closing existing browser:", e.message);
      }
    }

    // Launch new browser
    this.browser = await chromium.launch(this.options);

    let emulateTemplate = {
      ...iPhone15,
      locale: "en-US",
      deviceScaleFactor: Utils.getRandomInt(1, 3),
      isMobile: Math.random() > 0.5,
      hasTouch: Math.random() > 0.5,
      userAgent: this.userAgent,
    };
    emulateTemplate.viewport.width = Utils.getRandomInt(320, 1920);
    emulateTemplate.viewport.height = Utils.getRandomInt(320, 1920);

    this.context = await this.browser.newContext({
      bypassCSP: true,
      ...emulateTemplate,
    });

    this.page = await this.context.newPage();

    // await this.page.route("**/*", (route) => {
    //   return route.request().resourceType() === "script"
    //     ? route.abort()
    //     : route.continue();
    // });

    await this.page.goto(this.default_url, {
      waitUntil: "domcontentloaded",
    });

    let LOAD_SCRIPTS = ["webmssdk.js"];
    // Load scripts sequentially
    for (const script of LOAD_SCRIPTS) {
      await this.page.addScriptTag({
        path: `${__dirname}/javascript/${script}`,
      });
    }

    await this.page.evaluate(() => {
      // Use frontierSign from webmssdk.js for X-Bogus generation
      window.generateBogus = function generateBogus(params) {
        if (typeof window.byted_acrawler?.frontierSign !== "function") {
          throw new Error("webmssdk.js frontierSign function not found");
        }
        return window.byted_acrawler.frontierSign(params);
      };
      return this;
    });
  }

  async navigator() {
    // Get the "viewport" of the page, as reported by the page.
    const info = await this.page.evaluate(() => {
      return {
        deviceScaleFactor: window.devicePixelRatio,
        user_agent: window.navigator.userAgent,
        browser_language: window.navigator.language,
        browser_platform: window.navigator.platform,
        browser_name: window.navigator.appCodeName,
        browser_version: window.navigator.appVersion,
      };
    });
    return info;
  }
  async sign(link) {
    // Check if browser/page is still valid
    if (!this.browser || !this.page || this.page.isClosed()) {
      console.log("Browser/page is closed, reinitializing...");
      await this.init();
    }

    // Generate valid verifyFp
    let verify_fp = Utils.generateVerifyFp();
    let newUrl = link + "&verifyFp=" + verify_fp;
    let queryString = new URL(newUrl).searchParams.toString();

    // Use webmssdk.js frontierSign for X-Bogus - no fallbacks
    const bogusResult = await this.page.evaluate(`generateBogus("${queryString}")`);

    // Extract X-Bogus from the result object
    const bogus = bogusResult && typeof bogusResult === 'object' && bogusResult['X-Bogus']
      ? bogusResult['X-Bogus']
      : bogusResult;

    const signed_url = newUrl + "&X-Bogus=" + bogus;
    const timestamp = Date.now();

    return {
      verify_fp: verify_fp,
      signed_url: signed_url,
      "x-tt-params": this.xttparams(queryString),
      "x-bogus": bogus,
      "device-id": this.deviceId,
      timestamp: timestamp
    };
  }

  xttparams(query_str) {
    query_str += "&is_encryption=1";

    // Encrypt query string using aes-128-cbc
    const cipher = createCipheriv("aes-128-cbc", this.password, this.password);
    return Buffer.concat([cipher.update(query_str), cipher.final()]).toString(
      "base64"
    );
  }


  async close() {
    if (this.browser && !this.isExternalBrowser) {
      await this.browser.close();
      this.browser = null;
    }
    if (this.page) {
      this.page = null;
    }
  }
}

export default Signer;
